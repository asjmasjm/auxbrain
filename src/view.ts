import { ItemView, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import {
  AnalysisResult,
  DraftSelection,
  DocumentQuestionHistory,
  ReviewResult,
  ReviewedFact,
  UnderstandingFeedbackResult,
  UnderstandingEvidence,
  UnderstandingJob,
  UnderstandingResult,
  UnderstandingStage,
  WorkflowIntent,
  AuxBrainSettings,
  BridgeConfig,
  KnowledgeWriteJob,
  LlmProvider,
  PersonalKnowledgeRelation,
  PersonalKnowledgeSnapshot,
  findLlmProvider,
  labelEntityType,
  labelMode,
  labelPolarity,
  labelRelation
} from "./contracts";
import { friendlyError } from "./errors";

export const VIEW_TYPE_AUXBRAIN = "fkms-obsidian-ui-view";
const DEFAULT_EVIDENCE_COUNT = 1;
const QUESTION_SUGGESTION_COUNT = 5;
const RECOMMENDED_QUESTIONS = [
  {
    question: "这篇文章用了什么真机测试？",
    description: "Which real-world robot platforms were used for evaluation?"
  },
  {
    question: "使用了哪些数据集，分别用于训练还是评估？",
    description: "Which datasets were used for training and evaluation?"
  },
  {
    question: "提出了什么方法，核心改进是什么？",
    description: "What method was proposed, and what is its core contribution?"
  },
  {
    question: "与哪些基线进行了比较，结果如何？",
    description: "Which baselines were compared, and what were the results?"
  },
  {
    question: "做了哪些消融实验？",
    description: "Which ablation studies were conducted?"
  }
];

interface KnowledgeGraphNode {
  id: string;
  name: string;
  entityType: string;
  isPaper: boolean;
  relations: PersonalKnowledgeRelation[];
}

export interface AuxBrainViewHost {
  submitReview(analysisId: string, facts: ReviewedFact[]): Promise<ReviewResult>;
  analyzeInterpretation(
    draft: DraftSelection,
    interpretation: string
  ): Promise<AnalysisResult>;
  askUnderstanding(
    draft: DraftSelection,
    question: string,
    topN: number,
    onProgress?: (job: UnderstandingJob) => void
  ): Promise<UnderstandingResult>;
  submitUnderstandingFeedback(
    understandingId: string,
    rating: "up" | "down",
    correctionRequested: boolean | null,
    onProgress?: (job: KnowledgeWriteJob) => void
  ): Promise<UnderstandingFeedbackResult>;
  beginKnowledgeContribution(
    draft: DraftSelection,
    evidence: UnderstandingEvidence[]
  ): Promise<void>;
  loadActiveDocument(): Promise<void>;
  navigateToEvidence(
    draft: DraftSelection,
    evidence: UnderstandingEvidence
  ): Promise<void>;
  getSettings(): AuxBrainSettings;
  client(): {
    configuration(): Promise<BridgeConfig>;
    personalKnowledge(limit?: number): Promise<PersonalKnowledgeSnapshot>;
    questionHistory(
      sourcePath: string,
      paperTitle: string,
      limit?: number
    ): Promise<DocumentQuestionHistory>;
  };
  saveSettings(): Promise<void>;
  ensureLlmCredential(onSaved?: () => void): Promise<boolean>;
  openLlmConfiguration(
    provider?: LlmProvider,
    onSaved?: () => void,
    onBack?: () => void
  ): void;
  openRuntimeConfiguration(config?: BridgeConfig, onSaved?: () => void): void;
}

export class AuxBrainView extends ItemView {
  private readonly host: AuxBrainViewHost;
  private draft: DraftSelection | null = null;
  private analysis: AnalysisResult | null = null;
  private understanding: UnderstandingResult | null = null;
  private understandingJob: UnderstandingJob | null = null;
  private correctionEvidence: UnderstandingEvidence | null = null;
  private questionHistory: DocumentQuestionHistory | null = null;
  private questionHistoryLoading = false;
  private questionHistoryRequestId = 0;
  private intent: WorkflowIntent = "understand";
  private question = "";
  private interpretation = "";
  private analyzedInterpretation = "";
  private interpretationBusy = false;
  private evidenceDisplayCount = DEFAULT_EVIDENCE_COUNT;
  private understandingBusy = false;
  private feedbackBusy = false;
  private knowledgeWriteJob: KnowledgeWriteJob | null = null;
  private contributionBusy = false;
  private reviewBusy = false;
  private reviewCompleted = false;
  private feedbackRating: "up" | "down" | null = null;
  private feedbackKnowledge: UnderstandingFeedbackResult["knowledge"] | null = null;
  private showEvidenceReasoning = false;
  private showKnowledgeBase = false;
  private knowledge: PersonalKnowledgeSnapshot | null = null;
  private knowledgeLoading = false;
  private knowledgeError = "";
  private selectedKnowledgeNodeId: string | null = null;
  private knowledgeGraphObservers: ResizeObserver[] = [];
  private bridgeConfig: BridgeConfig | null = null;
  private configurationLoading = false;
  private configurationAttempted = false;
  private configurationError = "";

  constructor(leaf: WorkspaceLeaf, host: AuxBrainViewHost) {
    super(leaf);
    this.host = host;
  }

  getViewType(): string {
    return VIEW_TYPE_AUXBRAIN;
  }

  getDisplayText(): string {
    return "AuxBrain";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  isWorkflowBusy(): boolean {
    return this.understandingBusy
      || this.interpretationBusy
      || this.feedbackBusy
      || this.reviewBusy;
  }

  workflowBusyMessage(): string {
    if (this.feedbackBusy || this.reviewBusy) {
      return "知识库正在写入，请等待当前任务完成";
    }
    return "AuxBrain 正在回答或解析，请等待当前任务完成";
  }

  setUnderstandingDraft(draft: DraftSelection): void {
    if (this.isWorkflowBusy()) {
      new Notice(this.workflowBusyMessage());
      return;
    }
    this.draft = draft;
    this.analysis = null;
    this.understanding = null;
    this.understandingJob = null;
    this.correctionEvidence = null;
    this.questionHistory = null;
    this.questionHistoryLoading = false;
    this.intent = "understand";
    this.feedbackBusy = false;
    this.knowledgeWriteJob = null;
    this.contributionBusy = false;
    this.reviewBusy = false;
    this.reviewCompleted = false;
    this.question = "";
    this.feedbackRating = null;
    this.feedbackKnowledge = null;
    this.showEvidenceReasoning = false;
    this.evidenceDisplayCount = DEFAULT_EVIDENCE_COUNT;
    this.showKnowledgeBase = false;
    this.selectedKnowledgeNodeId = null;
    this.render();
    void this.loadQuestionHistory(draft);
  }

  setAnnotationDraft(draft: DraftSelection): void {
    if (this.isWorkflowBusy()) {
      new Notice(this.workflowBusyMessage());
      return;
    }
    this.draft = draft;
    this.analysis = null;
    this.understanding = null;
    this.understandingJob = null;
    this.correctionEvidence = null;
    this.questionHistoryRequestId += 1;
    this.questionHistory = null;
    this.questionHistoryLoading = false;
    this.intent = "annotate";
    this.interpretation = "";
    this.analyzedInterpretation = "";
    this.interpretationBusy = false;
    this.reviewBusy = false;
    this.reviewCompleted = false;
    this.showKnowledgeBase = false;
    this.selectedKnowledgeNodeId = null;
    this.render();
  }

  private render(): void {
    for (const observer of this.knowledgeGraphObservers) observer.disconnect();
    this.knowledgeGraphObservers = [];
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("fkms-root");
    const header = container.createDiv({ cls: "fkms-view-header" });
    header.createEl("h2", {
      text:
        this.showKnowledgeBase
          ? "AuxBrain 个人知识库"
          : this.correctionEvidence
          ? "AuxBrain 人工修正"
          : this.intent === "understand"
          ? "AuxBrain 细粒度理解"
          : "AuxBrain 人工标注"
    });
    const loadDocumentButton = header.createEl("button", {
      cls: "clickable-icon",
      attr: {
        type: "button",
        "aria-label": this.showKnowledgeBase ? "刷新个人知识库" : "载入当前文档",
        "data-tooltip-position": "left"
      }
    });
    setIcon(loadDocumentButton, "refresh-cw");
    loadDocumentButton.disabled = this.isWorkflowBusy();
    loadDocumentButton.onclick = async () => {
      if (this.showKnowledgeBase) {
        await this.loadPersonalKnowledge();
        return;
      }
      try {
        await this.host.loadActiveDocument();
      } catch (error) {
        new Notice(`无法读取当前文档：${friendlyError(error)}`);
      }
    };
    if (this.showKnowledgeBase) {
      this.renderBackNavigation(container, () => {
        this.showKnowledgeBase = false;
        this.selectedKnowledgeNodeId = null;
        this.render();
      });
      this.renderPersonalKnowledge(container);
      return;
    }
    if (!this.draft) {
      container.createEl("p", {
        text: "打开一篇 Markdown 或 PDF，然后点击上方刷新按钮载入当前文档并直接提问。"
      });
      const actions = container.createDiv({ cls: "fkms-primary-actions" });
      const load = actions.createEl("button", {
        cls: "mod-cta",
        attr: { type: "button" }
      });
      const loadIcon = load.createSpan({ cls: "fkms-button-icon" });
      setIcon(loadIcon, "file-input");
      load.createSpan({ text: "载入当前文档" });
      load.disabled = this.isWorkflowBusy();
      load.onclick = async () => {
        try {
          await this.host.loadActiveDocument();
        } catch (error) {
          new Notice(`无法读取当前文档：${friendlyError(error)}`);
        }
      };
      this.createRuntimeAction(actions);
      this.createKnowledgeToggle(actions);
      return;
    }
    if (this.intent === "understand") {
      if (this.correctionEvidence) {
        this.renderAnnotation(container);
      } else {
        this.renderUnderstanding(container);
      }
      return;
    }
    if (this.intent === "annotate") {
      this.renderAnnotation(container);
      return;
    }
  }

  private renderAnnotation(container: HTMLElement): void {
    if (!this.draft) return;
    if (this.correctionEvidence) {
      this.renderBackNavigation(container, () => this.exitCorrection());
      container.createDiv({
        cls: "fkms-correction-evidence",
        text: this.correctionEvidence.text
      });
    } else {
      this.renderDocumentBanner(container);
      const source = container.createEl("details", { cls: "fkms-original-details" });
      source.createEl("summary", { text: "查看原文" });
      source.createDiv({ cls: "fkms-original-text", text: this.draft.text });
    }

    container.createEl("label", {
      text: this.correctionEvidence
        ? "你对这句话阐述的道理"
        : "你对这段话的理解"
    });
    const input = container.createEl("textarea", {
      cls: "fkms-interpretation-input",
      attr: {
        rows: "5",
        placeholder: this.correctionEvidence
          ? "请输入你对这句话阐述的道理"
          : "例如：本文使用 DROID 训练模型，在 RoboCasa 上评估，并与 OpenVLA 进行比较。"
      }
    });
    input.value = this.interpretation;
    input.disabled = this.interpretationBusy || this.reviewBusy || this.reviewCompleted;
    input.oninput = () => {
      this.interpretation = input.value;
      const confirm = container.querySelector<HTMLButtonElement>(
        ".fkms-interpretation-confirm"
      );
      if (confirm) {
        confirm.disabled =
          !this.analysis?.facts.length
          || this.interpretation.trim() !== this.analyzedInterpretation
          || this.reviewBusy
          || this.reviewCompleted;
      }
    };

    new Setting(container).addButton((button) =>
      button
        .setButtonText(
          this.interpretationBusy
            ? "解析中"
            : this.analysis
              ? "重新解析"
              : "解析关系"
        )
        .setIcon("scan-search")
        .setCta()
        .setDisabled(
          this.interpretationBusy || this.reviewBusy || this.reviewCompleted
        )
        .onClick(() => void this.runInterpretationAnalysis())
    );

    if (this.interpretationBusy) {
      const status = container.createDiv({ cls: "fkms-knowledge-state" });
      const icon = status.createSpan({
        cls: "fkms-progress-stage-icon is-spinning"
      });
      setIcon(icon, "loader-circle");
      status.createSpan({ text: "正在进行实体识别与关系分类" });
      this.renderAnnotationActions(container);
      return;
    }
    if (!this.analysis) {
      this.renderAnnotationActions(container);
      return;
    }

    for (const warning of this.analysis.warnings) {
      container.createDiv({ cls: "fkms-warning", text: friendlyError(warning) });
    }
    this.renderTokenUsage(container, this.analysis.usage);

    if (!this.analysis.facts.length) {
      container.createDiv({
        cls: "fkms-empty fkms-interpretation-empty",
        text: "没有解析出可绑定原文证据的关系，请补充实体名称和它与论文的关系后重新解析。"
      });
      this.renderAnnotationActions(container);
      return;
    }

    const resultHeader = container.createDiv({ cls: "fkms-answer-header" });
    resultHeader.createEl("h3", { text: "关系解析" });
    resultHeader.createSpan({
      cls: "fkms-confidence-label",
      text: `${this.analysis.facts.length} 条`
    });

    const list = container.createDiv({ cls: "fkms-interpretation-relations" });
    for (const fact of this.analysis.facts) {
      const item = list.createDiv({ cls: "fkms-interpretation-relation" });
      const triple = item.createDiv({ cls: "fkms-interpretation-triple" });
      triple.createSpan({ cls: "fkms-interpretation-subject", text: "论文/系统" });
      triple.createSpan({
        cls: "fkms-interpretation-edge",
        text: labelRelation(fact.relation_type)
      });
      triple.createSpan({
        cls: "fkms-interpretation-object",
        text: fact.object_name
      });
      const meta = item.createDiv({ cls: "fkms-knowledge-meta" });
      meta.createSpan({ text: labelEntityType(fact.entity_type) });
      meta.createSpan({ text: labelPolarity(fact.polarity) });
      meta.createSpan({
        text: `置信度 ${Math.round(fact.confidence * 100)}%`
      });
    }

    this.renderAnnotationActions(container);
  }

  private renderAnnotationActions(container: HTMLElement): void {
    if (this.correctionEvidence && !this.analysis) return;
    const dirty = this.interpretation.trim() !== this.analyzedInterpretation;
    const canConfirm = Boolean(this.analysis?.facts.length)
      && !dirty
      && !this.interpretationBusy
      && !this.reviewBusy
      && !this.reviewCompleted;
    container.createDiv({
      cls: "fkms-action-hint",
      text: dirty && this.analysis
        ? "理解已修改，请重新解析后再入库。"
        : "确认后写入个人知识库。"
    });
    const actions = container.createDiv({
      cls: this.correctionEvidence
        ? "fkms-primary-actions is-correction"
        : "fkms-primary-actions"
    });
    const confirm = actions.createEl("button", {
      cls: "fkms-interpretation-confirm mod-cta",
      attr: { type: "button" }
    });
    const confirmIcon = confirm.createSpan({ cls: "fkms-button-icon" });
    setIcon(confirmIcon, this.reviewCompleted ? "circle-check" : "database-zap");
    confirm.createSpan({
      text: this.reviewBusy
        ? "入库中"
        : this.reviewCompleted
          ? "已入库"
          : "确认并入库"
    });
    confirm.disabled = !canConfirm;
    confirm.onclick = () => void this.submitInterpretationReview();
    if (this.correctionEvidence) {
      return;
    }
    this.createRuntimeAction(actions);
    this.createKnowledgeToggle(actions);
  }

  private exitCorrection(): void {
    this.correctionEvidence = null;
    this.analysis = null;
    this.interpretation = "";
    this.analyzedInterpretation = "";
    this.interpretationBusy = false;
    this.reviewBusy = false;
    this.reviewCompleted = false;
    this.render();
  }

  private async runInterpretationAnalysis(): Promise<void> {
    if (
      !this.draft
      || this.interpretationBusy
      || this.reviewCompleted
      || this.feedbackBusy
      || this.reviewBusy
    ) return;
    const interpretation = this.interpretation.trim();
    if (!interpretation) {
      new Notice("请先写下你对这段话的理解");
      return;
    }
    this.interpretationBusy = true;
    this.analysis = null;
    this.render();
    try {
      const analysisDraft = this.correctionEvidence
        ? {
            ...this.draft,
            text: this.correctionEvidence.text,
            sourceType: "selection" as const,
            sourceUnderstandingId: this.understanding?.understanding_id
          }
        : this.draft;
      this.analysis = await this.host.analyzeInterpretation(
        analysisDraft,
        interpretation
      );
      this.analyzedInterpretation = interpretation;
    } catch (error) {
      new Notice(`关系解析失败：${friendlyError(error)}`);
    } finally {
      this.interpretationBusy = false;
      this.render();
    }
  }

  private async submitInterpretationReview(): Promise<void> {
    if (
      !this.analysis
      || this.reviewBusy
      || this.reviewCompleted
      || this.understandingBusy
      || this.feedbackBusy
      || this.interpretation.trim() !== this.analyzedInterpretation
    ) {
      return;
    }
    const facts: ReviewedFact[] = this.analysis.facts.map((fact) => ({
      candidate_id: fact.candidate_id,
      accepted: true,
      object_id: fact.object_id,
      object_name: fact.object_name,
      entity_type: fact.entity_type,
      relation_type: fact.relation_type,
      polarity: fact.polarity,
      evidence_text: fact.evidence_text,
      confidence: fact.confidence,
      note: this.analyzedInterpretation
    }));
    if (!facts.length) return;

    this.reviewBusy = true;
    this.render();
    try {
      const result = await this.host.submitReview(this.analysis.analysis_id, facts);
      this.reviewCompleted = true;
      this.knowledge = null;
      new Notice(`已将 ${result.accepted} 条关系写入个人知识库`);
    } catch (error) {
      new Notice(`入库失败：${this.errorMessage(error)}`);
    } finally {
      this.reviewBusy = false;
      this.render();
    }
  }

  private renderUnderstanding(container: HTMLElement): void {
    if (!this.draft) return;
    const questionLocked = this.understandingBusy || this.feedbackBusy || this.reviewBusy;
    if (this.showEvidenceReasoning) {
      this.renderBackNavigation(container, () => {
        this.showEvidenceReasoning = false;
        this.render();
      });
    }
    this.renderDocumentBanner(container);

    container.createEl("label", { text: "针对当前文档提问" });
    const questionInput = container.createEl("textarea", {
      cls: "fkms-understanding-question",
      attr: {
        rows: "3",
        placeholder: "例如：该方法使用了哪些数据集，并与哪些基线进行了比较？"
      }
    });
    questionInput.value = this.question;
    questionInput.disabled = questionLocked;
    questionInput.oninput = () => {
      this.question = questionInput.value;
    };
    questionInput.onkeydown = (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.runUnderstanding();
      }
    };

    const chooseQuestion = (value: string): void => {
      this.question = value;
      questionInput.value = value;
      questionInput.focus();
    };

    const questionColumns = container.createDiv({ cls: "fkms-question-columns" });
    const historySection = questionColumns.createDiv({
      cls: "fkms-question-section is-history"
    });
    const historyHeader = historySection.createDiv({ cls: "fkms-question-section-header" });
    historyHeader.createEl("h3", { text: "用户提问" });
    const heat = historyHeader.createDiv({ cls: "fkms-question-heat" });
    const heatIcon = heat.createSpan({ cls: "fkms-question-heat-icon" });
    setIcon(heatIcon, "flame");
    heat.createSpan({
      text: this.questionHistoryLoading && !this.questionHistory
        ? "热度读取中"
        : `热度 ${this.questionHistory?.question_count ?? 0} 次`
    });
    const historyList = historySection.createDiv({ cls: "fkms-user-question-list" });
    const historyQuestions = this.questionHistory?.questions ?? [];
    if (!this.questionHistoryLoading && !historyQuestions.length) {
      historyList.createDiv({
        cls: "fkms-question-empty",
        text: "这篇论文还没有提问记录"
      });
    }
    for (const item of historyQuestions) {
      const historyButton = historyList.createEl("button", {
        cls: "fkms-user-question",
        attr: { type: "button" }
      });
      const icon = historyButton.createSpan({ cls: "fkms-button-icon" });
      setIcon(icon, "history");
      const copy = historyButton.createSpan({ cls: "fkms-user-question-copy" });
      copy.createSpan({
        cls: "fkms-user-question-text",
        text: item.question
      });
      const meta = copy.createSpan({ cls: "fkms-user-question-meta" });
      meta.createSpan({ text: `${item.ask_count} 次` });
      meta.createSpan({ text: this.formatQuestionTime(item.last_asked_at) });
      historyButton.disabled = questionLocked;
      historyButton.onclick = () => chooseQuestion(item.question);
    }

    const frequent = questionColumns.createDiv({
      cls: "fkms-question-section is-recommended"
    });
    const frequentHeader = frequent.createDiv({ cls: "fkms-question-section-header" });
    frequentHeader.createEl("h3", { text: "大家经常问" });
    const questionList = frequent.createDiv({ cls: "fkms-frequent-question-list" });
    for (const question of RECOMMENDED_QUESTIONS) {
      const suggestion = questionList.createEl("button", { attr: { type: "button" } });
      const icon = suggestion.createSpan({ cls: "fkms-button-icon" });
      setIcon(icon, "message-circle-question");
      const copy = suggestion.createSpan({ cls: "fkms-frequent-question-copy" });
      copy.createSpan({ cls: "fkms-frequent-question-text", text: question.question });
      copy.createSpan({
        cls: "fkms-frequent-question-description",
        text: question.description
      });
      suggestion.disabled = questionLocked;
      suggestion.onclick = () => chooseQuestion(question.question);
    }

    const actions = container.createDiv({ cls: "fkms-primary-actions" });
    const ask = actions.createEl("button", {
      cls: "mod-cta",
      attr: { type: "button" }
    });
    const askIcon = ask.createSpan({ cls: "fkms-button-icon" });
    setIcon(
      askIcon,
      this.understandingBusy
        ? "loader-circle"
        : this.feedbackBusy || this.reviewBusy
          ? "database-zap"
          : "send"
    );
    askIcon.toggleClass("is-spinning", this.understandingBusy);
    ask.createSpan({
      text: this.understandingBusy
        ? "回答中"
        : this.feedbackBusy || this.reviewBusy
          ? "等待入库"
          : "提问"
    });
    ask.disabled = questionLocked;
    ask.onclick = () => void this.runUnderstanding();
    this.createRuntimeAction(actions);
    this.createKnowledgeToggle(actions);

    if (this.feedbackBusy || this.reviewBusy) {
      container.createDiv({
        cls: "fkms-action-hint",
        text: "知识库写入完成后即可继续提问。"
      });
    }

    container.createDiv({
      cls: "fkms-document-summary",
      text: `已载入全文 · ${this.draft.segments?.length ?? 1} 个可定位片段`
    });

    if (this.understandingJob) {
      const progress = container.createDiv({ cls: "fkms-understanding-progress" });
      this.renderUnderstandingProgress(progress, this.understandingJob);
    }

    if (!this.understanding) return;
    const result = this.understanding;
    for (const warning of result.warnings) {
      container.createDiv({ cls: "fkms-warning", text: friendlyError(warning) });
    }

    const answerHeader = container.createDiv({ cls: "fkms-answer-header" });
    answerHeader.createEl("h3", { text: "回答" });
    const answerMeta = answerHeader.createDiv({ cls: "fkms-answer-meta" });
    answerMeta.createSpan({
      cls: "fkms-confidence-label",
      text: `综合置信度 ${Math.round(result.confidence * 100)}%`
    });
    const confidence = container.createEl("progress", {
      cls: "fkms-confidence-progress",
      attr: {
        max: "1",
        value: String(result.confidence),
        "aria-label": "回答综合置信度"
      }
    });
    confidence.value = result.confidence;
    container.createDiv({ cls: "fkms-understanding-answer", text: result.answer });
    if (!this.understandingJob) {
      this.renderTokenUsage(container, result.usage);
    }

    if (!this.showEvidenceReasoning) {
      const feedback = container.createDiv({ cls: "fkms-understanding-feedback" });
      feedback.createSpan({
        text: this.feedbackBusy ? "正在确认并写入知识库" : "这个回答是否有帮助？"
      });
      feedback.appendChild(
        this.feedbackButton("thumbs-up", "认可回答并写入知识库", "up", () => {
          void this.rateUnderstanding("up");
        })
      );
      feedback.appendChild(
        this.feedbackButton("thumbs-down", "不认可回答", "down", () => {
          void this.rateUnderstanding("down");
        })
      );
      const reasoningButton = feedback.createEl("button", {
        cls: "fkms-reasoning-toggle",
        attr: {
          type: "button",
          "aria-expanded": "false"
        }
      });
      const reasoningIcon = reasoningButton.createSpan({
        cls: "fkms-button-icon",
        attr: { "aria-hidden": "true" }
      });
      setIcon(reasoningIcon, "list-tree");
      reasoningButton.createSpan({ text: "查看AuxBrain回答依据" });
      reasoningButton.disabled = this.feedbackBusy || this.reviewBusy;
      reasoningButton.onclick = () => {
        this.showEvidenceReasoning = true;
        this.evidenceDisplayCount = DEFAULT_EVIDENCE_COUNT;
        this.render();
      };
      if (this.feedbackRating) {
        feedback.createSpan({
          cls: "fkms-feedback-saved",
          text: this.feedbackStatusText()
        });
      }
      if (this.knowledgeWriteJob) {
        const progress = container.createDiv({
          cls: "fkms-understanding-progress fkms-knowledge-write-progress"
        });
        this.renderStageProgress(
          progress,
          this.knowledgeWriteJob,
          "知识入库中",
          "知识入库完成",
          "知识入库失败",
          false
        );
      }
      return;
    }

    const availableEvidence = result.evidence_candidates?.length
      ? result.evidence_candidates
      : result.evidence;
    this.renderEvidenceReasoning(container, availableEvidence);
    const correction = container.createEl("button", {
      cls: "fkms-correction-start mod-cta",
      text: "我要修正",
      attr: { type: "button" }
    });
    correction.disabled = availableEvidence.length === 0 || this.isWorkflowBusy();
    correction.onclick = () => {
      const evidence = availableEvidence[0];
      if (!evidence) return;
      this.correctionEvidence = evidence;
      this.analysis = null;
      this.interpretation = "";
      this.analyzedInterpretation = "";
      this.interpretationBusy = false;
      this.reviewBusy = false;
      this.reviewCompleted = false;
      this.render();
    };
  }

  private async runUnderstanding(): Promise<void> {
    if (!this.draft || this.understandingBusy) return;
    if (this.feedbackBusy || this.reviewBusy) {
      new Notice("知识库正在写入，完成后再提问");
      return;
    }
    const question = this.question.trim();
    if (!question) {
      new Notice("请输入一个细粒度问题");
      return;
    }
    this.understandingBusy = true;
    this.render();
    try {
      if (!(await this.host.ensureLlmCredential(() => void this.reloadConfiguration()))) {
        return;
      }
      this.understanding = null;
      this.understandingJob = this.pendingUnderstandingJob();
      this.knowledgeWriteJob = null;
      this.feedbackRating = null;
      this.feedbackKnowledge = null;
      this.showEvidenceReasoning = false;
      this.evidenceDisplayCount = DEFAULT_EVIDENCE_COUNT;
      this.render();
      this.understanding = await this.host.askUnderstanding(
        this.draft,
        question,
        DEFAULT_EVIDENCE_COUNT,
        (job) => this.updateUnderstandingProgress(job)
      );
      await this.loadQuestionHistory(this.draft);
    } catch (error) {
      new Notice(`回答失败：${friendlyError(error)}`);
    } finally {
      this.understandingBusy = false;
      this.render();
    }
  }

  private async loadQuestionHistory(draft: DraftSelection): Promise<void> {
    const requestId = ++this.questionHistoryRequestId;
    this.questionHistoryLoading = true;
    this.render();
    try {
      const history = await this.host.client().questionHistory(
        draft.sourcePath,
        draft.title,
        QUESTION_SUGGESTION_COUNT
      );
      if (
        requestId === this.questionHistoryRequestId
        && this.draft?.sourcePath === draft.sourcePath
      ) {
        this.questionHistory = history;
      }
    } catch (_error) {
      if (requestId === this.questionHistoryRequestId) {
        this.questionHistory = null;
      }
    } finally {
      if (requestId === this.questionHistoryRequestId) {
        this.questionHistoryLoading = false;
        this.render();
      }
    }
  }

  private pendingUnderstandingJob(): UnderstandingJob {
    const mode = this.host.getSettings().analysisMode;
    const stageIds = mode === "llm"
      ? ["evidence_retrieval", "waiting_llm", "llm_answer"]
      : ["evidence_retrieval", "waiting_llm", "llm_answer", "algorithm_revision"];
    const labels: Record<string, string> = {
      evidence_retrieval: "准备候选证据",
      waiting_llm: "连接 LLM",
      llm_answer: "LLM 生成答案",
      algorithm_revision: "AuxBrain校正"
    };
    return {
      job_id: "local-pending",
      status: "running",
      mode,
      elapsed_ms: 0,
      stages: stageIds.map((id, index) => ({
        id,
        label: labels[id],
        status: index === 0 ? "running" : "pending",
        elapsed_ms: 0
      })),
      result: null,
      error: ""
    };
  }

  private updateUnderstandingProgress(job: UnderstandingJob): void {
    this.understandingJob = job;
    const container = this.containerEl.querySelector<HTMLElement>(
      ".fkms-understanding-progress"
    );
    if (!container) {
      this.render();
      return;
    }
    this.patchStageProgress(container, job, "回答处理中", "处理完成", "处理失败", true);
  }

  private renderUnderstandingProgress(
    container: HTMLElement,
    job: UnderstandingJob
  ): void {
    this.renderStageProgress(container, job, "回答处理中", "处理完成", "处理失败", true);
  }

  private updateKnowledgeWriteProgress(job: KnowledgeWriteJob): void {
    this.knowledgeWriteJob = job;
    const container = this.containerEl.querySelector<HTMLElement>(
      ".fkms-knowledge-write-progress"
    );
    if (!container) {
      this.render();
      return;
    }
    this.patchStageProgress(
      container,
      job,
      "知识入库中",
      "知识入库完成",
      "知识入库失败",
      false
    );
  }

  private renderStageProgress(
    container: HTMLElement,
    job: UnderstandingJob | KnowledgeWriteJob,
    runningTitle: string,
    completedTitle: string,
    errorTitle: string,
    showUsage: boolean
  ): void {
    const header = container.createDiv({ cls: "fkms-progress-header" });
    header.createSpan({
      cls: "fkms-progress-title",
      text:
        job.status === "completed"
          ? completedTitle
          : job.status === "error"
            ? errorTitle
            : runningTitle
    });
    header.createSpan({
      cls: "fkms-progress-total",
      text: `总计 ${this.formatDuration(job.elapsed_ms)}`
    });
    for (const stage of job.stages) {
      const stageElement = container.createDiv({
        cls: `fkms-progress-stage is-${stage.status}`,
        attr: {
          "data-stage-id": stage.id,
          "data-stage-status": stage.status
        }
      });
      const row = stageElement.createDiv({ cls: "fkms-progress-stage-row" });
      const icon = row.createSpan({ cls: "fkms-progress-stage-icon" });
      setIcon(icon, this.progressIcon(stage.status));
      row.createSpan({ cls: "fkms-progress-stage-label", text: stage.label });
      row.createSpan({
        cls: "fkms-progress-stage-time",
        text: this.stageTime(stage)
      });
      if (stage.status === "running") {
        this.addStageActivity(stageElement, stage.label);
      }
    }
    if (showUsage && "usage" in job) {
      this.renderTokenUsage(container, job.usage, job.usage_estimated === true);
    }
  }

  private patchStageProgress(
    container: HTMLElement,
    job: UnderstandingJob | KnowledgeWriteJob,
    runningTitle: string,
    completedTitle: string,
    errorTitle: string,
    showUsage: boolean
  ): void {
    const title = container.querySelector<HTMLElement>(".fkms-progress-title");
    const total = container.querySelector<HTMLElement>(".fkms-progress-total");
    if (!title || !total) {
      container.empty();
      this.renderStageProgress(
        container,
        job,
        runningTitle,
        completedTitle,
        errorTitle,
        showUsage
      );
      return;
    }
    title.setText(
      job.status === "completed"
        ? completedTitle
        : job.status === "error"
          ? errorTitle
          : runningTitle
    );
    total.setText(`总计 ${this.formatDuration(job.elapsed_ms)}`);

    for (const stage of job.stages) {
      const stageElement = Array.from(
        container.querySelectorAll<HTMLElement>(".fkms-progress-stage")
      ).find((element) => element.dataset.stageId === stage.id);
      if (!stageElement) {
        container.empty();
        this.renderStageProgress(
          container,
          job,
          runningTitle,
          completedTitle,
          errorTitle,
          showUsage
        );
        return;
      }
      const previousStatus = stageElement.dataset.stageStatus;
      if (previousStatus !== stage.status) {
        for (const status of ["pending", "running", "completed", "skipped", "error"]) {
          stageElement.removeClass(`is-${status}`);
        }
        stageElement.addClass(`is-${stage.status}`);
        stageElement.dataset.stageStatus = stage.status;
        const icon = stageElement.querySelector<HTMLElement>(
          ".fkms-progress-stage-icon"
        );
        if (icon) {
          icon.empty();
          setIcon(icon, this.progressIcon(stage.status));
        }
        stageElement.querySelector(".fkms-stage-activity")?.remove();
        if (stage.status === "running") {
          this.addStageActivity(stageElement, stage.label);
        }
      }
      stageElement
        .querySelector<HTMLElement>(".fkms-progress-stage-time")
        ?.setText(this.stageTime(stage));
    }
    if (showUsage && "usage" in job) {
      container.querySelector(".fkms-token-item")?.remove();
      this.renderTokenUsage(container, job.usage, job.usage_estimated === true);
    }
  }

  private addStageActivity(container: HTMLElement, label: string): void {
    const activity = container.createDiv({
      cls: "fkms-stage-activity",
      attr: { "aria-label": `${label}正在进行` }
    });
    activity.createSpan();
    activity.createSpan();
    activity.createSpan();
  }

  private stageTime(stage: UnderstandingStage): string {
    if (stage.status === "pending") return "等待";
    if (stage.status === "skipped") return "已跳过";
    if (stage.elapsed_ms === 0) return "<1 ms";
    return this.formatDuration(stage.elapsed_ms);
  }

  private progressIcon(status: string): string {
    if (status === "completed") return "circle-check";
    if (status === "running") return "loader-circle";
    if (status === "error") return "circle-x";
    if (status === "skipped") return "minus-circle";
    return "circle-dashed";
  }

  private formatDuration(milliseconds: number): string {
    if (milliseconds < 1_000) return `${milliseconds} ms`;
    return `${(milliseconds / 1_000).toFixed(1)} s`;
  }

  private formatQuestionTime(value: string): string {
    if (!value) return "时间未知";
    const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(date);
  }

  private async rateUnderstanding(rating: "up" | "down"): Promise<void> {
    if (
      !this.understanding
      || this.feedbackBusy
      || this.reviewBusy
      || this.understandingBusy
    ) return;
    this.feedbackBusy = true;
    this.knowledgeWriteJob = this.pendingKnowledgeWriteJob();
    this.render();
    try {
      const result = await this.host.submitUnderstandingFeedback(
        this.understanding.understanding_id,
        rating,
        null,
        (job) => this.updateKnowledgeWriteProgress(job)
      );
      this.feedbackRating = rating;
      this.feedbackKnowledge = result.knowledge;
      if (rating === "up") {
        this.knowledge = null;
        if (result.knowledge.status === "stored") {
          new Notice(`回答已认可，并写入 ${result.knowledge.accepted} 个知识点`);
        } else if (result.knowledge.status === "already_stored") {
          new Notice("该回答已经写入个人知识库");
        } else if (result.knowledge.status === "no_relations") {
          new Notice("回答已保存，暂未提炼出可绑定原文的实体关系");
        } else if (result.knowledge.status === "error") {
          new Notice(`回答已保存，关系入库失败：${result.knowledge.warnings[0] ?? "未知错误"}`);
        }
      }
      this.render();
    } catch (error) {
      new Notice(`评价保存失败：${this.errorMessage(error)}`);
    } finally {
      this.feedbackBusy = false;
      this.render();
    }
  }

  private pendingKnowledgeWriteJob(): KnowledgeWriteJob {
    const stages = [
      ["save_feedback", "保存用户确认"],
      ["relation_extraction", "解析实体关系"],
      ["knowledge_write", "写入个人知识库"]
    ] as const;
    return {
      job_id: "local-knowledge-pending",
      status: "running",
      mode: "knowledge",
      elapsed_ms: 0,
      stages: stages.map(([id, label], index) => ({
        id,
        label,
        status: index === 0 ? "running" : "pending",
        elapsed_ms: 0
      })),
      result: null,
      error: ""
    };
  }

  private feedbackStatusText(): string {
    if (this.feedbackRating === "down") return "已记录不认可";
    const accepted = this.feedbackKnowledge?.accepted ?? 0;
    if (accepted > 0) return `已认可 · 入库 ${accepted} 条`;
    if (this.feedbackKnowledge?.status === "error") return "已认可 · 入库失败";
    return "已认可 · 回答已保存";
  }

  private renderEvidenceReasoning(
    container: HTMLElement,
    evidence: UnderstandingEvidence[]
  ): void {
    const count = Math.min(this.evidenceDisplayCount, evidence.length);
    const evidenceHeader = container.createDiv({ cls: "fkms-answer-header" });
    evidenceHeader.createEl("h3", { text: "支持证据" });
    if (evidence.length) {
      const selector = evidenceHeader.createEl("select", {
        cls: "fkms-evidence-count-select",
        attr: { "aria-label": "支持证据数量" }
      });
      for (let value = 1; value <= Math.min(10, evidence.length); value += 1) {
        selector.createEl("option", { value: String(value), text: `Top-${value}` });
      }
      selector.value = String(count);
      selector.onchange = () => {
        this.evidenceDisplayCount = Number(selector.value);
        this.render();
      };
    }
    const evidenceList = container.createDiv({ cls: "fkms-understanding-evidence-list" });
    for (const itemEvidence of evidence.slice(0, count)) {
      const item = evidenceList.createEl("button", {
        cls: "fkms-understanding-evidence",
        attr: {
          type: "button",
          "aria-label": `定位到原文${itemEvidence.location_label ? `，${itemEvidence.location_label}` : ""}`
        }
      });
      item.onclick = async () => {
        if (!this.draft) return;
        try {
          await this.host.navigateToEvidence(this.draft, itemEvidence);
        } catch (error) {
          new Notice(`证据定位失败：${friendlyError(error)}`);
        }
      };
      const meta = item.createDiv({ cls: "fkms-evidence-rank" });
      meta.createSpan({ text: `#${itemEvidence.rank}` });
      if (itemEvidence.location_label) {
        meta.createSpan({ text: itemEvidence.location_label });
      }
      meta.createSpan({ text: `相关度 ${Math.round(itemEvidence.score * 100)}%` });
      if (itemEvidence.cited) {
        meta.createSpan({ cls: "fkms-cited-label", text: "答案引用" });
      }
      item.createDiv({ text: itemEvidence.text });
      const navigateIcon = item.createSpan({
        cls: "fkms-evidence-navigate",
        attr: { "aria-hidden": "true" }
      });
      setIcon(navigateIcon, "locate-fixed");
    }
  }

  private feedbackButton(
    icon: string,
    label: string,
    rating: "up" | "down",
    action: () => void
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clickable-icon fkms-feedback-button";
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tooltip-position", "top");
    button.setAttribute("aria-pressed", String(this.feedbackRating === rating));
    button.classList.toggle("is-active", this.feedbackRating === rating);
    button.disabled = this.isWorkflowBusy() || this.feedbackRating !== null;
    setIcon(button, icon);
    button.onclick = action;
    return button;
  }

  private renderDocumentBanner(container: HTMLElement): void {
    if (!this.draft) return;
    const banner = container.createDiv({ cls: "fkms-document-banner" });
    const icon = banner.createSpan({ cls: "fkms-document-icon" });
    setIcon(icon, this.draft.sourceType === "pdf" ? "file-text" : "file-type-2");
    const identity = banner.createDiv({ cls: "fkms-document-identity" });
    identity.createDiv({ cls: "fkms-document-title", text: this.draft.title });
    identity.createDiv({ cls: "fkms-document-path", text: this.draft.sourcePath });
  }

  private renderBackNavigation(container: HTMLElement, action: () => void): void {
    const navigation = container.createDiv({ cls: "fkms-back-navigation" });
    const button = navigation.createEl("button", {
      attr: { type: "button", "aria-label": "返回主菜单" }
    });
    const icon = button.createSpan({ cls: "fkms-button-icon" });
    setIcon(icon, "arrow-left");
    button.createSpan({ text: "返回主菜单" });
    button.disabled = this.isWorkflowBusy();
    button.onclick = action;
  }

  private createKnowledgeToggle(container: HTMLElement): HTMLButtonElement {
    const button = container.createEl("button", {
      cls: "fkms-knowledge-toggle",
      attr: {
        type: "button",
        "aria-label": this.showKnowledgeBase ? "返回工作面板" : "查看数据库"
      }
    });
    const icon = button.createSpan({
      cls: "fkms-button-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(icon, this.showKnowledgeBase ? "arrow-left" : "database");
    button.createSpan({
      text: this.showKnowledgeBase ? "返回工作面板" : "查看数据库"
    });
    button.disabled = this.isWorkflowBusy();
    button.onclick = () => {
      this.showKnowledgeBase = !this.showKnowledgeBase;
      this.selectedKnowledgeNodeId = null;
      this.render();
      if (this.showKnowledgeBase && !this.knowledgeLoading) {
        void this.loadPersonalKnowledge();
      }
    };
    return button;
  }

  private renderPersonalKnowledge(container: HTMLElement): void {
    if (this.knowledgeLoading && !this.knowledge) {
      const loading = container.createDiv({ cls: "fkms-knowledge-state" });
      const icon = loading.createSpan({ cls: "fkms-progress-stage-icon is-spinning" });
      setIcon(icon, "loader-circle");
      loading.createSpan({ text: "正在读取个人知识库" });
      return;
    }
    if (this.knowledgeError) {
      container.createDiv({ cls: "fkms-warning", text: this.knowledgeError });
      return;
    }
    if (!this.knowledge) return;

    const summary = container.createDiv({ cls: "fkms-knowledge-summary" });
    summary.createDiv({
      cls: "fkms-knowledge-stat",
      text: `实体 ${this.knowledge.entity_count.toLocaleString("zh-CN")}`
    });
    summary.createDiv({
      cls: "fkms-knowledge-stat",
      text: `关系 ${this.knowledge.total.toLocaleString("zh-CN")}`
    });
    if (!this.knowledge.relations.length) {
      container.createDiv({
        cls: "fkms-empty fkms-knowledge-empty",
        text: "尚未建立已确认的实体关系"
      });
      return;
    }

    const list = container.createDiv({ cls: "fkms-knowledge-graphs" });
    const papers = this.groupKnowledgeByPaper(this.knowledge.relations);
    let graphIndex = 0;
    for (const [paperTitle, relations] of papers) {
      graphIndex += 1;
      this.renderKnowledgeGraph(list, paperTitle, relations, graphIndex);
    }
    if (this.knowledge.total > this.knowledge.relations.length) {
      container.createDiv({
        cls: "fkms-document-summary",
        text: `显示最近 ${this.knowledge.relations.length} 条关系`
      });
    }
  }

  private groupKnowledgeByPaper(
    relations: PersonalKnowledgeRelation[]
  ): Map<string, PersonalKnowledgeRelation[]> {
    const papers = new Map<string, PersonalKnowledgeRelation[]>();
    for (const relation of relations) {
      const paperTitle = relation.paper_title || relation.subject_name || "未命名论文";
      const group = papers.get(paperTitle) ?? [];
      group.push(relation);
      papers.set(paperTitle, group);
    }
    return papers;
  }

  private renderKnowledgeGraph(
    container: HTMLElement,
    paperTitle: string,
    relations: PersonalKnowledgeRelation[],
    graphIndex: number
  ): void {
    const section = container.createDiv({ cls: "fkms-knowledge-graph-section" });
    const header = section.createDiv({ cls: "fkms-knowledge-graph-header" });
    const headerIcon = header.createSpan({ cls: "fkms-knowledge-graph-header-icon" });
    setIcon(headerIcon, "network");
    header.createEl("h3", { text: paperTitle });
    header.createSpan({ text: `${relations.length} 条关系` });

    const nodes = this.buildKnowledgeGraphNodes(paperTitle, relations);
    const stage = section.createDiv({ cls: "fkms-knowledge-graph-stage" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("fkms-knowledge-graph-lines");
    svg.setAttribute("aria-hidden", "true");
    stage.appendChild(svg);
    const markerId = `fkms-graph-arrow-${graphIndex}`;
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const nodeElements = new Map<string, HTMLButtonElement>();
    const orderedNodes = Array.from(nodes.values()).sort((left, right) => {
      if (left.isPaper !== right.isPaper) return left.isPaper ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN");
    });
    for (const node of orderedNodes) {
      const selectionId = `${paperTitle}::${node.id}`;
      const button = stage.createEl("button", {
        cls: `fkms-knowledge-graph-node is-${node.entityType}`,
        attr: {
          type: "button",
          "aria-pressed": String(this.selectedKnowledgeNodeId === selectionId)
        }
      });
      if (node.isPaper) button.addClass("is-paper");
      if (this.selectedKnowledgeNodeId === selectionId) button.addClass("is-selected");
      const icon = button.createSpan({ cls: "fkms-knowledge-graph-node-icon" });
      setIcon(icon, this.knowledgeNodeIcon(node.entityType));
      const copy = button.createSpan({ cls: "fkms-knowledge-graph-node-copy" });
      copy.createSpan({ cls: "fkms-knowledge-graph-node-name", text: node.name });
      copy.createSpan({
        cls: "fkms-knowledge-graph-node-type",
        text: node.isPaper ? "论文" : labelEntityType(node.entityType)
      });
      button.onclick = () => {
        this.selectedKnowledgeNodeId =
          this.selectedKnowledgeNodeId === selectionId ? null : selectionId;
        this.render();
      };
      nodeElements.set(node.id, button);
    }

    const draw = (): void => {
      if (!stage.isConnected) return;
      this.drawKnowledgeGraphEdges(
        stage,
        svg,
        relations,
        nodeElements,
        markerId,
        paperTitle
      );
    };
    window.requestAnimationFrame(draw);
    const observer = new ResizeObserver(() => window.requestAnimationFrame(draw));
    observer.observe(stage);
    this.knowledgeGraphObservers.push(observer);

    const selectedNode = orderedNodes.find(
      (node) => this.selectedKnowledgeNodeId === `${paperTitle}::${node.id}`
    );
    if (selectedNode) this.renderKnowledgeNodeDetail(section, selectedNode);
  }

  private buildKnowledgeGraphNodes(
    paperTitle: string,
    relations: PersonalKnowledgeRelation[]
  ): Map<string, KnowledgeGraphNode> {
    const nodes = new Map<string, KnowledgeGraphNode>();
    for (const relation of relations) {
      const subjectId = this.knowledgeSubjectNodeId(relation, paperTitle);
      const subject = nodes.get(subjectId) ?? {
        id: subjectId,
        name: relation.subject_name,
        entityType: relation.subject_entity_type || relation.subject_type,
        isPaper: relation.subject_type === "paper",
        relations: []
      };
      subject.relations.push(relation);
      nodes.set(subjectId, subject);

      const objectId = `entity:${relation.object_id}`;
      const object = nodes.get(objectId) ?? {
        id: objectId,
        name: relation.object_name,
        entityType: relation.entity_type,
        isPaper: false,
        relations: []
      };
      object.relations.push(relation);
      nodes.set(objectId, object);
    }
    return nodes;
  }

  private drawKnowledgeGraphEdges(
    stage: HTMLElement,
    svg: SVGSVGElement,
    relations: PersonalKnowledgeRelation[],
    nodeElements: Map<string, HTMLButtonElement>,
    markerId: string,
    paperTitle: string
  ): void {
    svg.querySelectorAll(".fkms-knowledge-graph-edge").forEach((item) => item.remove());
    stage.querySelectorAll(".fkms-knowledge-graph-edge-label").forEach((item) => item.remove());
    const stageRect = stage.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);
    svg.setAttribute("width", String(stageRect.width));
    svg.setAttribute("height", String(stageRect.height));
    relations.forEach((relation, index) => {
      const source = nodeElements.get(
        this.knowledgeSubjectNodeId(relation, paperTitle)
      );
      const target = nodeElements.get(`entity:${relation.object_id}`);
      if (!source || !target || source === target) return;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const sourceX = sourceRect.left - stageRect.left + sourceRect.width / 2;
      const targetX = targetRect.left - stageRect.left + targetRect.width / 2;
      const targetBelow = targetRect.top >= sourceRect.bottom;
      const sourceY = (targetBelow ? sourceRect.bottom : sourceRect.top) - stageRect.top;
      const targetY = (targetBelow ? targetRect.top : targetRect.bottom) - stageRect.top;
      const bend = Math.max(20, Math.abs(targetY - sourceY) * 0.45);
      const direction = targetBelow ? 1 : -1;
      const offset = ((index % 5) - 2) * 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("fkms-knowledge-graph-edge");
      path.setAttribute(
        "d",
        `M ${sourceX + offset} ${sourceY} C ${sourceX + offset} ${sourceY + bend * direction}, ${targetX + offset} ${targetY - bend * direction}, ${targetX + offset} ${targetY}`
      );
      path.setAttribute("marker-end", `url(#${markerId})`);
      svg.appendChild(path);

      const label = stage.createDiv({
        cls: "fkms-knowledge-graph-edge-label",
        text: labelRelation(relation.relation_type)
      });
      label.style.left = `${(sourceX + targetX) / 2}px`;
      label.style.top = `${(sourceY + targetY) / 2}px`;
    });
  }

  private renderKnowledgeNodeDetail(
    container: HTMLElement,
    node: KnowledgeGraphNode
  ): void {
    const detail = container.createDiv({ cls: "fkms-knowledge-node-detail" });
    const header = detail.createDiv({ cls: "fkms-knowledge-node-detail-header" });
    const title = header.createDiv();
    title.createEl("h4", { text: node.name });
    title.createSpan({ text: node.isPaper ? "论文" : labelEntityType(node.entityType) });
    const close = header.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": "关闭实体详情" }
    });
    setIcon(close, "x");
    close.onclick = () => {
      this.selectedKnowledgeNodeId = null;
      this.render();
    };

    for (const relation of node.relations) {
      const item = detail.createDiv({ cls: "fkms-knowledge-node-relation" });
      const triple = item.createDiv({ cls: "fkms-knowledge-node-relation-triple" });
      triple.createSpan({ text: relation.subject_name });
      triple.createSpan({ text: labelRelation(relation.relation_type) });
      triple.createSpan({ text: relation.object_name });
      const meta = item.createDiv({ cls: "fkms-knowledge-meta" });
      meta.createSpan({ text: labelPolarity(relation.polarity) });
      meta.createSpan({ text: `置信度 ${Math.round(relation.confidence * 100)}%` });
      meta.createSpan({ text: this.formatQuestionTime(relation.updated_at) });
      if (relation.source_question) {
        item.createDiv({
          cls: "fkms-knowledge-detail-question",
          text: `问题：${relation.source_question}`
        });
      }
      if (relation.source_answer) {
        item.createDiv({
          cls: "fkms-knowledge-detail-answer",
          text: relation.source_answer
        });
      }
      if (relation.evidence_text) {
        const evidence = item.createEl("details", { cls: "fkms-knowledge-evidence" });
        evidence.createEl("summary", { text: "查看原文证据" });
        evidence.createEl("p", { text: relation.evidence_text });
      }
    }
  }

  private knowledgeSubjectNodeId(
    relation: PersonalKnowledgeRelation,
    paperTitle: string
  ): string {
    return relation.subject_type === "paper"
      ? `paper:${paperTitle}`
      : `entity:${relation.subject_id || relation.subject_name}`;
  }

  private knowledgeNodeIcon(entityType: string): string {
    const icons: Record<string, string> = {
      paper: "file-text",
      model: "cpu",
      dataset: "database",
      robot: "bot",
      environment: "box",
      method: "workflow",
      component: "blocks",
      metric: "gauge",
      task: "target",
      domain: "scan"
    };
    return icons[entityType] ?? "circle-dot";
  }

  private async loadPersonalKnowledge(): Promise<void> {
    if (this.knowledgeLoading) return;
    this.knowledgeLoading = true;
    this.knowledgeError = "";
    this.render();
    try {
      this.knowledge = await this.host.client().personalKnowledge(200);
    } catch (error) {
      this.knowledgeError = `个人知识库读取失败：${friendlyError(error)}`;
    } finally {
      this.knowledgeLoading = false;
      this.render();
    }
  }

  private renderRuntimeControls(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "fkms-runtime-panel" });
    if (!this.bridgeConfig) {
      if (this.configurationError) panel.addClass("is-disconnected");
      const status = panel.createDiv({ cls: "fkms-runtime-loading" });
      status.createSpan({ cls: "fkms-status-dot" });
      status.createSpan({
        text: this.configurationError || "正在连接本地服务"
      });
      if (this.configurationError) {
        status.dataset.state = "error";
        const retry = status.createEl("button", {
          cls: "clickable-icon fkms-runtime-icon",
          attr: {
            type: "button",
            "aria-label": "重新连接本地服务",
            "data-tooltip-position": "bottom"
          }
        });
        setIcon(retry, "refresh-cw");
        retry.onclick = () => void this.reloadConfiguration();

        const download = panel.createEl("a", {
          cls: "fkms-companion-download",
          attr: {
            href: "https://github.com/asjmasjm/auxbrain/releases/tag/0.8.2",
            target: "_blank",
            rel: "noopener"
          }
        });
        const downloadIcon = download.createSpan({ cls: "fkms-button-icon" });
        setIcon(downloadIcon, "download");
        download.createSpan({ text: "下载 Companion 0.8.2" });
        panel.createDiv({
          cls: "fkms-companion-warning",
          text: "未签名 Beta 可能触发 Windows SmartScreen。请仅从官方 Release 下载并核对 SHA-256。"
        });
      } else if (!this.configurationLoading && !this.configurationAttempted) {
        void this.reloadConfiguration();
      }
      return;
    }

    const settings = this.host.getSettings();
    const provider = findLlmProvider(this.bridgeConfig, settings.llmProvider);
    const modeButton = panel.createEl("button", {
      cls: "fkms-runtime-summary",
      attr: {
        type: "button",
        "aria-label": "打开回答模式设置"
      }
    });
    const modeIcon = modeButton.createSpan({ cls: "fkms-runtime-summary-icon" });
    setIcon(modeIcon, "sliders-horizontal");
    const copy = modeButton.createSpan({ cls: "fkms-runtime-summary-copy" });
    copy.createSpan({ cls: "fkms-runtime-label", text: "回答模式" });
    copy.createSpan({
      cls: "fkms-runtime-summary-value",
      text: `${labelMode(settings.analysisMode)} · ${provider?.name ?? settings.llmProvider} / ${settings.llmModel}`
    });
    const state = modeButton.createSpan({ cls: "fkms-runtime-connection" });
    state.dataset.state = provider?.configured ? "ok" : "warning";
    state.createSpan({ cls: "fkms-status-dot" });
    state.createSpan({ text: provider?.configured ? "READY" : "KEY" });
    const chevron = modeButton.createSpan({ cls: "fkms-runtime-summary-icon" });
    setIcon(chevron, "chevron-right");
    modeButton.disabled = this.isWorkflowBusy();
    modeButton.onclick = () =>
      this.host.openRuntimeConfiguration(this.bridgeConfig!, () =>
        void this.reloadConfiguration()
      );
  }

  private createRuntimeAction(container: HTMLElement): HTMLButtonElement {
    const settings = this.host.getSettings();
    const provider = this.bridgeConfig
      ? findLlmProvider(this.bridgeConfig, settings.llmProvider)
      : undefined;
    const button = container.createEl("button", {
      cls: "fkms-runtime-action",
      attr: {
        type: "button",
        "aria-label": "打开回答模式设置"
      }
    });
    const icon = button.createSpan({ cls: "fkms-button-icon" });
    setIcon(icon, "sliders-horizontal");
    button.createSpan({ text: "回答模式" });
    button.title = this.bridgeConfig
      ? `${labelMode(settings.analysisMode)} · ${provider?.name ?? settings.llmProvider} / ${settings.llmModel}`
      : "正在读取回答模式";
    button.disabled = this.isWorkflowBusy() || !this.bridgeConfig;
    button.onclick = () => {
      if (!this.bridgeConfig) return;
      this.host.openRuntimeConfiguration(this.bridgeConfig, () =>
        void this.reloadConfiguration()
      );
    };
    if (!this.bridgeConfig && !this.configurationLoading && !this.configurationAttempted) {
      void this.reloadConfiguration();
    }
    return button;
  }

  private async reloadConfiguration(): Promise<void> {
    if (this.configurationLoading) return;
    this.configurationLoading = true;
    this.configurationAttempted = true;
    this.configurationError = "";
    try {
      const config = await this.host.client().configuration();
      this.bridgeConfig = config;
      const settings = this.host.getSettings();
      let changed = false;
      let provider = findLlmProvider(config, settings.llmProvider);
      if (!provider && config.llm.providers.length) {
        provider = config.llm.providers[0];
        settings.llmProvider = provider.id;
        changed = true;
      }
      if (provider && !provider.models.some((model) => model.id === settings.llmModel)) {
        settings.llmModel = provider.default_model;
        changed = true;
      }
      if (settings.analysisMode === "algorithm") {
        settings.analysisMode = "hybrid";
        changed = true;
      }
      if (changed) await this.host.saveSettings();
    } catch (error) {
      this.bridgeConfig = null;
      this.configurationError = `本地服务未连接：${friendlyError(error)}`;
    } finally {
      this.configurationLoading = false;
      this.render();
    }
  }

  private renderTokenUsage(
    container: HTMLElement,
    usage: Record<string, number> | undefined,
    estimated = false
  ): void {
    const input = this.validTokenCount(usage?.input_tokens);
    const output = this.validTokenCount(usage?.output_tokens);
    const reportedTotal = this.validTokenCount(usage?.total_tokens);
    const total = reportedTotal ?? (input !== null && output !== null ? input + output : null);
    if (total === null) return;

    const item = container.createDiv({ cls: "fkms-token-item" });
    const icon = item.createSpan({ cls: "fkms-token-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "binary");
    item.toggleClass("is-estimated", estimated);
    item.createSpan({
      cls: "fkms-token-label",
      text: estimated ? "Token 实时估算" : "Token 消耗"
    });
    item.createSpan({
      cls: "fkms-token-total",
      text: total.toLocaleString("zh-CN")
    });
    if (input !== null || output !== null) {
      const detail = [
        input !== null ? `输入 ${input.toLocaleString("zh-CN")}` : "",
        output !== null ? `输出 ${output.toLocaleString("zh-CN")}` : ""
      ].filter(Boolean);
      item.createSpan({ cls: "fkms-token-detail", text: detail.join(" · ") });
    }
  }

  private validTokenCount(value: number | undefined): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
