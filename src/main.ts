import {
  App,
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf
} from "obsidian";
import { AuxBrainClient } from "./api";
import {
  AnalysisResult,
  AuxBrainSettings,
  BridgeConfig,
  DraftSelection,
  LlmProvider,
  KnowledgeWriteJob,
  ReviewResult,
  ReviewedFact,
  UnderstandingFeedbackResult,
  UnderstandingEvidence,
  UnderstandingJob,
  UnderstandingResult,
  findLlmProvider
} from "./contracts";
import { friendlyError } from "./errors";
import { LlmConfigurationModal } from "./llm-config-modal";
import { RuntimeConfigurationModal } from "./runtime-config-modal";
import { AuxBrainView, AuxBrainViewHost, VIEW_TYPE_AUXBRAIN } from "./view";
import { readActiveDocument } from "./document-reader";
import { navigateToEvidence } from "./evidence-navigation";

const DEFAULT_SETTINGS: AuxBrainSettings = {
  bridgeUrl: "http://127.0.0.1:8795",
  reviewer: "obsidian",
  analysisMode: "hybrid",
  llmProvider: "deepseek",
  llmModel: "deepseek-v4-flash"
};

export default class AuxBrainPlugin extends Plugin implements AuxBrainViewHost {
  settings: AuxBrainSettings = DEFAULT_SETTINGS;
  private lastSelectedText = "";
  private analysisInFlight = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_AUXBRAIN,
      (leaf) => new AuxBrainView(leaf, this)
    );
    this.addSettingTab(new AuxBrainSettingTab(this.app, this));

    this.addRibbonIcon("brain-circuit", "打开 AuxBrain", async () => {
      await this.openCurrentDocumentQuestion();
    });

    this.addCommand({
      id: "ask-current-document",
      name: "向当前文档提问",
      callback: async () => {
        await this.openCurrentDocumentQuestion();
      }
    });

    this.addCommand({
      id: "add-selection",
      name: "将选中文字加入 AuxBrain",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.analyzeSelection(editor, view);
      }
    });

    this.addCommand({
      id: "configure-llm",
      name: "配置 AuxBrain API Key",
      callback: () => this.openLlmConfiguration()
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selectedText = editor.getSelection().trim();
        this.addDocumentQuestionMenuItem(menu);
        if (selectedText) {
          this.addAnnotationMenuItem(menu, async () => selectedText, {
            sourcePath: view.file?.path ?? "untitled",
            title: view.file?.basename ?? "Obsidian selection"
          });
        }
      })
    );

    this.registerDomEvent(document, "selectionchange", () => {
      const selection = window.getSelection()?.toString().trim() ?? "";
      if (selection) this.lastSelectedText = selection;
    });
    this.registerDomEvent(document, "mouseup", () => {
      const selection = window.getSelection()?.toString().trim() ?? "";
      if (selection) this.lastSelectedText = selection;
    });

    const contextMenuHandler = (event: MouseEvent): void => {
      if (this.isEditableTarget(event.target)) return;
      const file = this.app.workspace.getActiveFile();
      const activeIsPdf = file?.extension.toLowerCase() === "pdf";
      const selection = window.getSelection()?.toString().trim() || this.lastSelectedText;
      if (!selection && !activeIsPdf) return;
      const menu = new Menu();
      this.addDocumentQuestionMenuItem(menu);
      if (selection) {
        this.addAnnotationMenuItem(menu, () => this.resolveSelectedText(selection), {
          sourcePath: file?.path ?? "selection",
          title: file?.basename ?? "Obsidian selection"
        });
      }
      event.preventDefault();
      event.stopPropagation();
      menu.showAtMouseEvent(event);
    };
    document.addEventListener("contextmenu", contextMenuHandler, { capture: true });
    this.register(() => {
      document.removeEventListener("contextmenu", contextMenuHandler, {
        capture: true
      });
    });

    this.addCommand({
      id: "open-fkms-view",
      name: "打开 AuxBrain 面板",
      callback: async () => {
        await this.openCurrentDocumentQuestion();
      }
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AUXBRAIN);
  }

  async submitReview(
    analysisId: string,
    facts: ReviewedFact[]
  ): Promise<ReviewResult> {
    return this.client().review(analysisId, this.settings.reviewer, facts);
  }

  async askUnderstanding(
    draft: DraftSelection,
    question: string,
    topN: number,
    onProgress?: (job: UnderstandingJob) => void
  ): Promise<UnderstandingResult> {
    return this.client().understand(
      draft,
      question,
      topN,
      this.settings,
      onProgress
    );
  }

  async submitUnderstandingFeedback(
    understandingId: string,
    rating: "up" | "down",
    correctionRequested: boolean | null,
    onProgress?: (job: KnowledgeWriteJob) => void
  ): Promise<UnderstandingFeedbackResult> {
    return this.client().saveUnderstandingFeedback(
      understandingId,
      this.settings.reviewer,
      rating,
      correctionRequested,
      this.settings,
      onProgress
    );
  }

  async beginKnowledgeContribution(
    draft: DraftSelection,
    evidence: UnderstandingEvidence[]
  ): Promise<void> {
    const text = evidence.map((item) => item.text).join("\n").trim();
    const correctionDraft: DraftSelection = {
      text: text || draft.text,
      sourcePath: draft.sourcePath,
      title: draft.title,
      sourceType: "selection"
    };
    await this.openAnnotationDraft(correctionDraft);
  }

  async analyzeInterpretation(
    draft: DraftSelection,
    interpretation: string
  ): Promise<AnalysisResult> {
    if (this.analysisInFlight) {
      throw new Error("关系解析正在进行，请稍候");
    }
    this.analysisInFlight = true;
    try {
      if (
        this.settings.analysisMode !== "algorithm"
        && !(await this.ensureLlmCredential())
      ) {
        throw new Error("请先配置当前 LLM 提供商的 API Key");
      }
      return await this.client().analyzeInterpretation(
        draft,
        interpretation,
        this.settings
      );
    } finally {
      this.analysisInFlight = false;
    }
  }

  async loadActiveDocument(): Promise<void> {
    const currentView = this.currentAuxBrainView();
    if (currentView?.isWorkflowBusy()) {
      new Notice(currentView.workflowBusyMessage());
      return;
    }
    const draft = await readActiveDocument(this.app);
    const leaf = await this.activateView();
    if (leaf.view instanceof AuxBrainView) {
      leaf.view.setUnderstandingDraft(draft);
    }
  }

  async navigateToEvidence(
    draft: DraftSelection,
    evidence: UnderstandingEvidence
  ): Promise<void> {
    await navigateToEvidence(this.app, draft, evidence);
  }

  client(): AuxBrainClient {
    return new AuxBrainClient(this.settings.bridgeUrl);
  }

  getSettings(): AuxBrainSettings {
    return this.settings;
  }

  openLlmConfiguration(
    provider: LlmProvider = this.settings.llmProvider,
    onSaved?: () => void,
    onBack?: () => void
  ): void {
    new LlmConfigurationModal(this.app, this, provider, onSaved, onBack).open();
  }

  async openRuntimeConfiguration(
    config?: BridgeConfig,
    onSaved?: () => void
  ): Promise<void> {
    try {
      const latest = config ?? await this.client().configuration();
      new RuntimeConfigurationModal(this.app, this, latest, onSaved).open();
    } catch (error) {
      new Notice(`无法读取回答模式：${friendlyError(error)}`);
    }
  }

  async ensureLlmCredential(onSaved?: () => void): Promise<boolean> {
    try {
      const config = await this.client().configuration();
      const provider = findLlmProvider(config, this.settings.llmProvider);
      if (provider?.configured) return true;
      this.openLlmConfiguration(this.settings.llmProvider, onSaved);
      return false;
    } catch (error) {
      new Notice(`无法读取 LLM 配置：${friendlyError(error)}`);
      return false;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async analyzeSelection(
    editor: Editor,
    view: MarkdownView
  ): Promise<void> {
    const text = editor.getSelection().trim();
    if (!text) {
      new Notice("请先选中一段文字");
      return;
    }
    await this.openAnnotationDraft({
      text,
      sourcePath: view.file?.path ?? "untitled",
      title: view.file?.basename ?? "Obsidian selection",
      sourceType: "selection"
    });
  }

  private addDocumentQuestionMenuItem(menu: Menu): void {
    menu.addItem((item) =>
      item
        .setTitle("向当前文档提问")
        .setIcon("message-circle-question")
        .onClick(async () => {
          await this.openCurrentDocumentQuestion();
        })
    );
  }

  private addAnnotationMenuItem(
    menu: Menu,
    getText: () => Promise<string>,
    source: { sourcePath: string; title: string }
  ): void {
    menu.addItem((item) =>
      item
        .setTitle("加入 AuxBrain")
        .setIcon("brain-circuit")
        .onClick(async () => {
          await this.handleSelectionAction(getText, source);
        })
    );
  }

  private async handleSelectionAction(
    getText: () => Promise<string>,
    source: { sourcePath: string; title: string }
  ): Promise<void> {
    const text = (await getText()).trim();
    if (!text) {
      new Notice("没有读取到选中文字。请重新选择，必要时先按 Ctrl+C");
      return;
    }
    await this.openAnnotationDraft({
      text,
      ...source,
      sourceType: "selection"
    });
  }

  private async openCurrentDocumentQuestion(): Promise<void> {
    const currentView = this.currentAuxBrainView();
    if (currentView?.isWorkflowBusy()) {
      new Notice(currentView.workflowBusyMessage());
      return;
    }
    new Notice("正在读取当前文档...");
    try {
      await this.loadActiveDocument();
    } catch (error) {
      await this.activateView();
      new Notice(`无法读取当前文档：${friendlyError(error)}`);
    }
  }

  private async openAnnotationDraft(draft: DraftSelection): Promise<void> {
    const currentView = this.currentAuxBrainView();
    if (currentView?.isWorkflowBusy()) {
      new Notice(currentView.workflowBusyMessage());
      return;
    }
    const leaf = await this.activateView();
    if (leaf.view instanceof AuxBrainView) {
      leaf.view.setAnnotationDraft(draft);
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return false;
    return Boolean(
      element.closest("textarea, input, select, [contenteditable='true'], .cm-editor")
    );
  }

  private async resolveSelectedText(selection: string): Promise<string> {
    const current = window.getSelection()?.toString().trim();
    if (current) {
      this.lastSelectedText = current;
      return current;
    }
    if (selection) return selection;
    try {
      return (await navigator.clipboard.readText()).trim();
    } catch (_error) {
      return "";
    }
  }

  private async activateView(): Promise<WorkspaceLeaf> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AUXBRAIN)[0];
    if (existing) {
      this.app.workspace.rightSplit.expand();
      this.app.workspace.revealLeaf(existing);
      return existing;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("无法打开 AuxBrain 面板");
    await leaf.setViewState({ type: VIEW_TYPE_AUXBRAIN, active: true });
    this.app.workspace.rightSplit.expand();
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private currentAuxBrainView(): AuxBrainView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AUXBRAIN)[0];
    return leaf?.view instanceof AuxBrainView ? leaf.view : null;
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.analysisMode === "algorithm") {
      this.settings.analysisMode = "hybrid";
      await this.saveSettings();
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

class AuxBrainSettingTab extends PluginSettingTab {
  private readonly plugin: AuxBrainPlugin;

  constructor(app: App, plugin: AuxBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AuxBrain 设置" });

    new Setting(containerEl)
      .setName("当前供应商密钥")
      .setDesc("模式、供应商和模型在 AuxBrain 面板中直接选择。")
      .addButton((button) =>
        button
          .setButtonText("管理 Key")
          .setIcon("key-round")
          .onClick(() => this.plugin.openLlmConfiguration())
      );

    new Setting(containerEl).setName("本地服务地址").addText((text) =>
      text.setValue(this.plugin.settings.bridgeUrl).onChange(async (value) => {
        this.plugin.settings.bridgeUrl = value.trim() || DEFAULT_SETTINGS.bridgeUrl;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("标注人").addText((text) =>
      text.setValue(this.plugin.settings.reviewer).onChange(async (value) => {
        this.plugin.settings.reviewer = value.trim() || DEFAULT_SETTINGS.reviewer;
        await this.plugin.saveSettings();
      })
    );

    const status = containerEl.createDiv({ cls: "fkms-settings-status" });
    status.setText("正在读取本地服务状态...");
    void this.refreshStatus(status);
  }

  private async refreshStatus(element: HTMLElement): Promise<void> {
    try {
      const config = await this.plugin.client().configuration();
      const providers = config.llm.providers
        .map((provider) => `${provider.name}：${provider.configured ? "已配置" : "未配置"}`)
        .join("\n");
      element.setText(
        `Companion：${config.service_version}（API ${config.api_protocol_version}）\n本地数据库：${config.db_path}\n${providers}\n实体：${config.stats.entities ?? 0}，已确认关系：${config.stats.assertions ?? 0}`
      );
    } catch (error) {
      element.setText(`无法连接本地服务：${this.errorMessage(error)}`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
