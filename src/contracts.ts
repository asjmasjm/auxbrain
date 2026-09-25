export type AnalysisMode = "hybrid" | "llm" | "algorithm";
export type LlmProvider = "deepseek" | "volcengine-ark";

export interface AuxBrainSettings {
  bridgeUrl: string;
  reviewer: string;
  analysisMode: AnalysisMode;
  llmProvider: LlmProvider;
  llmModel: string;
}

export interface DraftSelection {
  text: string;
  sourcePath: string;
  title: string;
  sourceType?: "markdown" | "pdf" | "selection";
  segments?: DocumentSegment[];
  sourceUnderstandingId?: string;
}

export interface DocumentSegment {
  text: string;
  locator: EvidenceLocator;
  location_label: string;
}

export interface EvidenceLocator {
  kind?: "markdown" | "pdf";
  line_start?: number;
  line_end?: number;
  page?: number;
  begin_index?: number;
  begin_offset?: number;
  end_index?: number;
  end_offset?: number;
}

export interface EntitySummary {
  entity_id: string;
  entity_type: string;
  canonical_name: string;
}

export interface FactCandidate {
  candidate_id: string;
  object_id: string;
  object_name: string;
  entity_type: string;
  relation_type: string;
  polarity: string;
  evidence_text: string;
  confidence: number;
  reason: string;
  source: string;
  resolution_status: string;
  matched_alias: string;
  allowed_relations: string[];
}

export interface AnalysisResult {
  analysis_id: string;
  requested_mode: AnalysisMode;
  actual_mode: AnalysisMode;
  analyzer_version: string;
  provider: string;
  model: string;
  prompt_version: string;
  text: string;
  facts: FactCandidate[];
  warnings: string[];
  usage: Record<string, number>;
  entity_catalog: EntitySummary[];
  entity_types: string[];
  polarities: string[];
  relation_descriptions: Record<string, string>;
  relations_by_entity_type: Record<string, string[]>;
}

export interface ReviewedFact {
  candidate_id: string;
  accepted: boolean;
  object_id: string;
  object_name: string;
  entity_type: string;
  relation_type: string;
  polarity: string;
  evidence_text: string;
  confidence: number;
  note: string;
}

export interface ReviewResult {
  analysis_id: string;
  accepted: number;
  corrected: number;
  rejected: number;
  submissions: Array<{
    candidate_id: string;
    submission_id: string;
    assertion_id: string;
    review_status: string;
    created_assertion: boolean;
  }>;
}

export interface BridgeConfig {
  profile: string;
  db_path: string;
  metadata: Record<string, string>;
  stats: Record<string, number>;
  analysis_modes: AnalysisMode[];
  llm: {
    provider: string;
    model: string;
    configured: boolean;
    credential_error: string;
    providers: LlmProviderConfig[];
  };
}

export interface LlmProviderConfig {
  id: LlmProvider;
  name: string;
  configured: boolean;
  credential_error: string;
  default_model: string;
  models: Array<{
    id: string;
    name: string;
  }>;
}

export interface LlmTestResult {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  usage: Record<string, number>;
}

export interface UnderstandingEvidence {
  evidence_id: string;
  rank: number;
  text: string;
  score: number;
  cited: boolean;
  locator: EvidenceLocator;
  location_label: string;
}

export interface UnderstandingResult {
  understanding_id: string;
  question: string;
  answer: string;
  confidence: number;
  provider: string;
  model: string;
  evidence: UnderstandingEvidence[];
  evidence_candidates?: UnderstandingEvidence[];
  warnings: string[];
  usage: Record<string, number>;
}

export type UnderstandingJobStatus = "pending" | "running" | "completed" | "error";
export type UnderstandingStageStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "error";

export interface UnderstandingStage {
  id: string;
  label: string;
  status: UnderstandingStageStatus;
  elapsed_ms: number;
}

export interface UnderstandingJob {
  job_id: string;
  status: UnderstandingJobStatus;
  mode: AnalysisMode;
  elapsed_ms: number;
  stages: UnderstandingStage[];
  usage?: Record<string, number>;
  usage_estimated?: boolean;
  result: UnderstandingResult | null;
  error: string;
}

export interface UnderstandingFeedbackResult {
  understanding_id: string;
  rating: "up" | "down";
  correction_requested: boolean | null;
  stored: boolean;
  knowledge: {
    status: "not_requested" | "stored" | "already_stored" | "no_relations" | "error";
    analysis_id: string;
    accepted: number;
    warnings: string[];
  };
}

export interface KnowledgeWriteJob {
  job_id: string;
  status: UnderstandingJobStatus;
  mode: "knowledge";
  elapsed_ms: number;
  stages: UnderstandingStage[];
  result: UnderstandingFeedbackResult | null;
  error: string;
}

export interface DocumentQuestionHistory {
  source_path: string;
  paper_title: string;
  question_count: number;
  questions: Array<{
    question: string;
    ask_count: number;
    last_asked_at: string;
  }>;
}

export interface PersonalKnowledgeRelation {
  assertion_id: string;
  subject_type: string;
  subject_id: string;
  subject_name: string;
  subject_entity_type: string;
  relation_type: string;
  polarity: string;
  object_id: string;
  object_name: string;
  entity_type: string;
  confidence: number;
  evidence_text: string;
  assignment_method: string;
  updated_at: string;
  source_understanding_id: string;
  source_question: string;
  source_answer: string;
  paper_title: string;
  source_uri: string;
}

export interface PersonalKnowledgeSnapshot {
  entity_count: number;
  total: number;
  relations: PersonalKnowledgeRelation[];
}

export type WorkflowIntent = "understand" | "annotate";

export function findLlmProvider(
  config: BridgeConfig,
  provider: LlmProvider
): LlmProviderConfig | undefined {
  return config.llm.providers.find((item) => item.id === provider);
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  domain: "领域",
  dataset: "数据集",
  model: "模型",
  metric: "指标",
  robot: "机器人",
  environment: "环境",
  task: "任务",
  method: "方法",
  component: "组件",
  other: "其他"
};

const RELATION_LABELS: Record<string, string> = {
  mentioned: "仅提及",
  in_domain: "属于领域",
  trained_on: "用数据集训练",
  trained_in: "在环境中训练",
  pretrained_on: "用数据集预训练",
  trains_model: "训练模型",
  distills_from_model: "从模型蒸馏",
  evaluated_on: "在数据集/基准上评估",
  compared_with: "与对象比较",
  introduced: "提出/引入",
  derived_from: "源自/基于",
  evaluated_with_robot: "用实体机器人评估",
  evaluated_with_embodiment: "用仿真实体评估",
  evaluated_in: "在环境中评估",
  collects_data_in: "在环境中采集数据",
  collects_data_with_robot: "用机器人采集数据",
  collects_data_with_embodiment: "用仿真实体采集数据",
  collects_data_via_method: "通过方法采集数据",
  evaluated_in_domain: "在领域中评估",
  evaluated_on_task: "在任务上评估",
  trained_for_task: "为任务训练",
  reports_metric: "报告指标",
  uses_method: "使用方法",
  uses_component: "使用组件",
  ablates: "消融组件/方法",
  outperforms: "优于基线"
};

const POLARITY_LABELS: Record<string, string> = {
  asserted: "肯定",
  negated: "否定",
  uncertain: "不确定"
};

const SOURCE_LABELS: Record<string, string> = {
  algorithm: "AuxBrain 本地分析",
  llm: "LLM-Only",
  llm_verified: "AuxBrain",
  "llm+algorithm": "AuxBrain",
  human_manual: "人工新增"
};

const RELATION_DESCRIPTIONS_ZH: Record<string, string> = {
  mentioned: "原文只提到该实体，没有足够证据支持更强关系。",
  in_domain: "论文或系统属于该研究或应用领域。",
  trained_on: "原文描述系统使用该数据集进行训练、微调或优化。",
  trained_in: "原文描述训练或优化发生在该环境中。",
  pretrained_on: "原文描述系统使用该数据集进行预训练。",
  trains_model: "原文描述论文训练或微调了该模型。",
  distills_from_model: "原文描述该模型被用作蒸馏教师模型。",
  evaluated_on: "原文描述系统在该数据集或基准上进行评估。",
  compared_with: "原文描述该实体作为直接比较对象或基线。",
  introduced: "原文描述论文提出、引入或发布了该实体。",
  derived_from: "原文描述该实体源自、基于或扩展自已有实体。",
  evaluated_with_robot: "原文描述评估发生在实体机器人硬件上。",
  evaluated_with_embodiment: "原文描述评估使用了仿真机器人本体。",
  evaluated_in: "原文描述评估发生在该环境或模拟器中。",
  collects_data_in: "原文描述在该环境中采集或生成数据。",
  collects_data_with_robot: "原文描述使用实体机器人采集数据。",
  collects_data_with_embodiment: "原文描述使用仿真机器人本体采集或生成数据。",
  collects_data_via_method: "原文描述通过该方法采集数据。",
  evaluated_in_domain: "原文描述实验或比较覆盖该研究或应用领域。",
  evaluated_on_task: "原文描述评估包含该任务。",
  trained_for_task: "原文描述系统针对该任务进行训练或优化。",
  reports_metric: "原文描述评估报告了该指标。",
  uses_method: "原文描述系统使用该方法。",
  uses_component: "原文描述系统使用该模型或组件。",
  ablates: "原文描述对该组件或方法进行了消融实验。",
  outperforms: "原文明确声称系统优于该基线。"
};

export function labelEntityType(value: string): string {
  return ENTITY_TYPE_LABELS[value] ?? value;
}

export function labelRelation(value: string): string {
  return RELATION_LABELS[value] ?? value;
}

export function labelPolarity(value: string): string {
  return POLARITY_LABELS[value] ?? value;
}

export function labelSource(value: string): string {
  return SOURCE_LABELS[value] ?? value;
}

export function labelMode(value: AnalysisMode): string {
  if (value === "hybrid") return "AuxBrain";
  if (value === "llm") return "LLM-Only";
  return "AuxBrain";
}

export function describeRelation(value: string): string {
  return RELATION_DESCRIPTIONS_ZH[value] ?? "请根据原文审核这条关系。";
}
