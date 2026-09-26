import { requestUrl } from "obsidian";
import {
  AnalysisResult,
  AuxBrainSettings,
  BridgeConfig,
  DraftSelection,
  DocumentQuestionHistory,
  KnowledgeWriteJob,
  LlmTestResult,
  PersonalKnowledgeSnapshot,
  ReviewResult,
  ReviewedFact,
  UnderstandingFeedbackResult,
  UnderstandingJob,
  UnderstandingResult
} from "./contracts";

const EXPECTED_COMPANION_SERVICE = "auxbrain-companion";
const EXPECTED_API_PROTOCOL_VERSION = 1;
const MINIMUM_COMPANION_VERSION = "0.8.4";

export class AuxBrainClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async analyze(
    draft: DraftSelection,
    settings: AuxBrainSettings
  ): Promise<AnalysisResult> {
    return this.post<AnalysisResult>("/api/v1/analyze", {
      text: draft.text,
      mode: settings.analysisMode,
      provider: settings.llmProvider,
      model: settings.llmModel,
      paper_title: draft.title,
      source_path: draft.sourcePath,
      source_understanding_id: draft.sourceUnderstandingId ?? "",
      source_uri: `obsidian://${draft.sourcePath}`
    });
  }

  async analyzeInterpretation(
    draft: DraftSelection,
    interpretation: string,
    settings: AuxBrainSettings
  ): Promise<AnalysisResult> {
    return this.post<AnalysisResult>("/api/v1/analyze", {
      text: draft.text,
      interpretation,
      mode: settings.analysisMode,
      provider: settings.llmProvider,
      model: settings.llmModel,
      paper_title: draft.title,
      source_path: draft.sourcePath,
      source_understanding_id: draft.sourceUnderstandingId ?? "",
      source_uri: `obsidian://${draft.sourcePath}`
    });
  }

  async review(
    analysisId: string,
    reviewer: string,
    facts: ReviewedFact[]
  ): Promise<ReviewResult> {
    return this.post<ReviewResult>("/api/v1/review", {
      analysis_id: analysisId,
      reviewer,
      facts
    });
  }

  async understand(
    draft: DraftSelection,
    question: string,
    topN: number,
    settings: AuxBrainSettings,
    onProgress?: (job: UnderstandingJob) => void
  ): Promise<UnderstandingResult> {
    const payload = {
      text: draft.text,
      question,
      top_n: topN,
      mode: settings.analysisMode,
      provider: settings.llmProvider,
      model: settings.llmModel,
      paper_title: draft.title,
      source_path: draft.sourcePath,
      source_uri: `obsidian://${draft.sourcePath}`,
      segments: draft.segments ?? []
    };
    const started = await this.post<UnderstandingJob>(
      "/api/v1/understand/jobs",
      payload
    );
    onProgress?.(started);
    let job = started;
    while (job.status === "pending" || job.status === "running") {
      await delay(300);
      job = await this.get<UnderstandingJob>(
        `/api/v1/understand/jobs/${encodeURIComponent(job.job_id)}?t=${Date.now()}`
      );
      onProgress?.(job);
    }
    if (job.status === "error" || !job.result) {
      throw new Error(job.error || "理解任务未返回结果");
    }
    return job.result;
  }

  async saveUnderstandingFeedback(
    understandingId: string,
    reviewer: string,
    rating: "up" | "down",
    correctionRequested: boolean | null,
    settings: AuxBrainSettings,
    onProgress?: (job: KnowledgeWriteJob) => void
  ): Promise<UnderstandingFeedbackResult> {
    const started = await this.post<KnowledgeWriteJob>(
      "/api/v1/understand/feedback/jobs",
      {
        understanding_id: understandingId,
        reviewer,
        rating,
        correction_requested: correctionRequested,
        mode: settings.analysisMode,
        provider: settings.llmProvider,
        model: settings.llmModel
      }
    );
    onProgress?.(started);
    let job = started;
    while (job.status === "pending" || job.status === "running") {
      await delay(300);
      job = await this.get<KnowledgeWriteJob>(
        `/api/v1/understand/feedback/jobs/${encodeURIComponent(job.job_id)}?t=${Date.now()}`
      );
      onProgress?.(job);
    }
    if (job.status === "error" || !job.result) {
      throw new Error(job.error || "知识库写入任务未返回结果");
    }
    return job.result;
  }

  async configuration(): Promise<BridgeConfig> {
    const config = await this.get<BridgeConfig>("/api/v1/config");
    this.assertCompatibleCompanion(config);
    return config;
  }

  async personalKnowledge(limit = 200): Promise<PersonalKnowledgeSnapshot> {
    return this.get<PersonalKnowledgeSnapshot>(
      `/api/v1/knowledge?limit=${encodeURIComponent(String(limit))}`
    );
  }

  async questionHistory(
    sourcePath: string,
    paperTitle: string,
    limit = 5
  ): Promise<DocumentQuestionHistory> {
    const params = [
      `source_path=${encodeURIComponent(sourcePath)}`,
      `paper_title=${encodeURIComponent(paperTitle)}`,
      `limit=${encodeURIComponent(String(limit))}`
    ].join("&");
    return this.get<DocumentQuestionHistory>(
      `/api/v1/understand/history?${params}`
    );
  }

  async saveLlmCredential(provider: string, apiKey: string): Promise<void> {
    await this.post("/api/v1/config/llm", { provider, api_key: apiKey });
  }

  async testLlm(provider: string, model: string): Promise<LlmTestResult> {
    return this.post<LlmTestResult>("/api/v1/config/llm/test", {
      provider,
      model
    });
  }

  private async get<T>(path: string): Promise<T> {
    const response = await requestUrl({
      url: `${this.baseUrl}${path}`,
      method: "GET"
    });
    return this.unwrap<T>(response.status, response.json, response.text);
  }

  private async post<T = unknown>(path: string, payload: unknown): Promise<T> {
    const response = await requestUrl({
      url: `${this.baseUrl}${path}`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(payload)
    });
    return this.unwrap<T>(response.status, response.json, response.text);
  }

  private unwrap<T>(status: number, body: unknown, text: string): T {
    if (status < 200 || status >= 300) {
      const error = body as { error?: string } | null;
      throw new Error(error?.error || text || `AuxBrain 服务返回 ${status}`);
    }
    return body as T;
  }

  private assertCompatibleCompanion(config: BridgeConfig): void {
    if (
      config.service !== EXPECTED_COMPANION_SERVICE ||
      typeof config.service_version !== "string"
    ) {
      throw new Error(`本地服务版本过旧，请下载并启动 Companion ${MINIMUM_COMPANION_VERSION}`);
    }
    if (config.api_protocol_version !== EXPECTED_API_PROTOCOL_VERSION) {
      throw new Error(
        `Companion API 不兼容：需要协议 ${EXPECTED_API_PROTOCOL_VERSION}，当前为 ${String(config.api_protocol_version)}`
      );
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
