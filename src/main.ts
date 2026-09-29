import {
  App,
  Editor,
  FileView,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
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
import { readDocument } from "./document-reader";
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
  private activeDocument: TFile | null = null;
  private documentRequestId = 0;
  private documentRead: AbortController | null = null;
  private setupPrompted = false;
  private configurationModal: Modal | null = null;
  private configurationOpening = false;
  private unloaded = false;
  private contextMenuDocuments = new WeakSet<Document>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_AUXBRAIN,
      (leaf) => new AuxBrainView(leaf, this)
    );
    this.addSettingTab(new AuxBrainSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file) this.trackDocument(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      this.registerContextMenuDocument(leaf?.view.containerEl.ownerDocument);
      if (leaf?.view instanceof FileView && leaf.view.file) {
        this.trackDocument(leaf.view.file);
      }
    }));
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.app.workspace.iterateAllLeaves(leaf => this.registerContextMenuDocument(leaf.view.containerEl.ownerDocument));
      const file = this.currentDocumentFile();
      if (file) this.trackDocument(file);
    });

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
      name: "配置 AuxBrain 接口密钥",
      callback: () => this.openLlmConfiguration()
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selectedText = editor.getSelection().trim();
        this.addDocumentQuestionMenuItem(menu, view.file ?? undefined);
        if (selectedText) {
          this.addAnnotationMenuItem(menu, async () => selectedText, {
            sourcePath: view.file?.path ?? "untitled",
            title: view.file?.basename ?? "Obsidian selection"
          });
        }
      })
    );

    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile) this.addDocumentQuestionMenuItem(menu, file);
    }));
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, openedWindow) => {
      this.registerContextMenuDocument(openedWindow.document);
    }));

    this.registerDomEvent(document, "selectionchange", () => {
      const selection = window.getSelection()?.toString().trim() ?? "";
      if (selection) this.lastSelectedText = selection;
    });
    this.registerDomEvent(document, "mouseup", () => {
      const selection = window.getSelection()?.toString().trim() ?? "";
      if (selection) this.lastSelectedText = selection;
    });

    this.registerContextMenuDocument(document);

    this.addCommand({
      id: "open-fkms-view",
      name: "打开 AuxBrain 面板",
      callback: async () => {
        await this.openCurrentDocumentQuestion();
      }
    });
  }

  async onunload(): Promise<void> {
    this.unloaded = true;
    this.cancelDocumentRead();
    this.configurationModal?.close();
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
    onProgress?: (job: UnderstandingJob) => void,
    requestKey?: string
  ): Promise<UnderstandingResult> {
    return this.client().understand(
      draft,
      question,
      topN,
      this.settings,
      onProgress,
      requestKey
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
        throw new Error("请先配置当前 LLM 提供商的 接口密钥");
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

  async loadActiveDocument(requestedFile?: TFile): Promise<void> {
    const currentView = this.currentAuxBrainView();
    if (currentView?.isWorkflowBusy()) {
      new Notice(currentView.workflowBusyMessage());
      return;
    }
    const file = requestedFile ?? this.currentDocumentFile();
    if (!file) throw new Error("请先打开一篇 Markdown 或 PDF 文档");
    this.activeDocument = file;
    await this.activateView();
    await this.syncDocument(true);
  }

  onViewOpened(): void {
    this.activeDocument = this.currentDocumentFile();
    void this.syncDocument();
  }

  onWorkflowIdle(): void {
    void this.syncDocument();
  }

  private trackDocument(file: TFile): void {
    if (this.unloaded) return;
    if (file.path !== this.activeDocument?.path) this.lastSelectedText = "";
    this.activeDocument = file;
    void this.syncDocument();
  }

  private cancelDocumentRead(): void {
    this.documentRequestId += 1;
    this.documentRead?.abort();
    this.documentRead = null;
  }

  private async syncDocument(force = false): Promise<void> {
    const view = this.currentAuxBrainView();
    const file = this.activeDocument;
    if (this.unloaded || !view || !file) return;
    if (view.isWorkflowBusy()) {
      view.setPendingDocument(view.documentPath === file.path ? "" : file.basename);
      return;
    }
    if (!force && view.documentPath === file.path) {
      view.setPendingDocument("");
      return;
    }
    this.cancelDocumentRead();
    const requestId = this.documentRequestId;
    const controller = new AbortController();
    this.documentRead = controller;
    view.beginDocumentLoad({
      text: "", sourcePath: file.path, title: file.basename,
      sourceType: file.extension.toLowerCase() === "pdf" ? "pdf" : "markdown"
    });
    const isCurrent = (): boolean => !this.unloaded
      && requestId === this.documentRequestId
      && this.currentAuxBrainView() === view;
    try {
      const draft = await readDocument(this.app, file, controller.signal);
      if (isCurrent()) view.setUnderstandingDraft(draft);
    } catch (error) {
      if (isCurrent()) view.setDocumentError(friendlyError(error));
    } finally {
      if (requestId === this.documentRequestId) this.documentRead = null;
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
    if (this.unloaded || this.configurationModal) return;
    const modal = new LlmConfigurationModal(
      this.app, this, provider, onSaved,
      onBack ?? (() => void this.openRuntimeConfiguration(undefined, onSaved)),
      () => { if (this.configurationModal === modal) this.configurationModal = null; }
    );
    this.configurationModal = modal;
    modal.open();
  }

  async openRuntimeConfiguration(
    config?: BridgeConfig,
    onSaved?: () => void,
    firstUse = false
  ): Promise<void> {
    if (this.unloaded || this.configurationModal || this.configurationOpening) return;
    this.configurationOpening = true;
    try {
      const latest = config ?? await this.client().configuration();
      if (this.unloaded || this.configurationModal) return;
      const modal = new RuntimeConfigurationModal(this.app, this, latest, onSaved, firstUse,
        () => { if (this.configurationModal === modal) this.configurationModal = null; }
      );
      this.configurationModal = modal;
      modal.open();
    } catch (error) {
      new Notice(`无法读取回答模式：${friendlyError(error)}`);
    } finally {
      this.configurationOpening = false;
    }
  }

  promptLlmSetup(config: BridgeConfig, onSaved: () => void): void {
    if (this.setupPrompted || this.configurationModal || this.configurationOpening
      || findLlmProvider(config, this.settings.llmProvider)?.configured) return;
    this.setupPrompted = true;
    void this.openRuntimeConfiguration(config, onSaved, true);
  }

  async ensureLlmCredential(onSaved?: () => void): Promise<boolean> {
    try {
      const config = await this.client().configuration();
      const provider = findLlmProvider(config, this.settings.llmProvider);
      if (provider?.configured) return true;
      await this.openRuntimeConfiguration(config, onSaved, true);
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

  private currentDocumentFile(): TFile | null {
    const active = this.app.workspace.getActiveFile();
    const recent = this.app.workspace.getMostRecentLeaf()?.view;
    return active ?? (recent instanceof FileView ? recent.file : null) ?? this.activeDocument;
  }

  private addDocumentQuestionMenuItem(menu: Menu, file = this.currentDocumentFile()): boolean {
    const view = this.currentAuxBrainView();
    const loaded = view?.hasDocumentContext(file?.path ?? "");
    const right = this.app.workspace.rightSplit;
    const hiddenInDock = view && right.collapsed && view.containerEl.closest(".mod-right-split");
    const visible = view?.containerEl.isShown() && !hiddenInDock;
    if (!file || !["pdf", "md"].includes(file.extension.toLowerCase()) || this.analysisInFlight
      || view?.isWorkflowBusy() || (loaded && visible)) return false;
    menu.addItem((item) =>
      item
        .setTitle(loaded ? "打开当前文档的 AuxBrain" : "为当前文档载入AuxBrain")
        .setIcon("file-input")
        .onClick(async () => {
          const current = this.currentAuxBrainView();
          if (current?.isWorkflowBusy()) { new Notice(current.workflowBusyMessage()); return; }
          if (current?.hasDocumentContext(file.path)) {
            this.activeDocument = file;
            await this.activateView();
          } else await this.openCurrentDocumentQuestion(file);
        })
    );
    return true;
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

  private async openCurrentDocumentQuestion(file?: TFile): Promise<void> {
    const currentView = this.currentAuxBrainView();
    if (currentView?.isWorkflowBusy()) {
      new Notice(currentView.workflowBusyMessage());
      return;
    }
    new Notice("正在读取当前文档...");
    try {
      await this.loadActiveDocument(file);
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
      this.cancelDocumentRead();
      leaf.view.setAnnotationDraft(draft);
    }
  }

  private registerContextMenuDocument(doc?: Document): void {
    if (!doc || this.unloaded || this.contextMenuDocuments.has(doc)) return;
    this.contextMenuDocuments.add(doc);
    const handler = (event: MouseEvent) => this.handleContextMenu(event);
    doc.addEventListener("contextmenu", handler, { capture: true });
    this.register(() => doc.removeEventListener("contextmenu", handler, { capture: true }));
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.unloaded) return;
    // Pop-out windows and SVG targets do not share the main window's HTMLElement constructor.
    const target = (event.composedPath?.() ?? [event.target]).find(node =>
      node && typeof (node as Element).closest === "function") as Element | undefined;
    if (!target || this.isEditableTarget(target) || target.closest(".menu, .modal-container")) return;
    const content = target.closest(".workspace-leaf-content");
    const type = content?.getAttribute("data-type") ?? "";
    const reader = ["pdf", "markdown"].includes(type);
    const rightBlank = target.closest(".workspace-split.mod-right-split") &&
      (!content || ["empty", "outline", "backlink", "outgoing-link", "tag", "all-properties"].includes(type));
    if (!reader && type !== VIEW_TYPE_AUXBRAIN && !rightBlank) return;
    const source = reader ? this.app.workspace.getLeavesOfType(type).find(leaf => leaf.view.containerEl.contains(target))?.view : null;
    const file = source instanceof FileView ? source.file : this.currentDocumentFile();
    const doc = target.ownerDocument ?? document;
    const selected = reader ? (doc.defaultView?.getSelection() ?? window.getSelection?.()) : null;
    const selection = selected && (!selected.anchorNode || content?.contains(selected.anchorNode)) ? selected.toString().trim() : "";
    const menu = new Menu();
    const added = this.addDocumentQuestionMenuItem(menu, file ?? undefined);
    if (!added && !selection) return;
    if (selection) this.addAnnotationMenuItem(menu, async () => selection, {
      sourcePath: file?.path ?? "selection", title: file?.basename ?? "Obsidian selection"
    });
    try {
      menu.showAtMouseEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
    } catch (error) {
      new Notice(`无法显示 AuxBrain 菜单：${friendlyError(error)}`);
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const element = target as Element | null;
    if (!element || typeof element.closest !== "function") return false;
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
          .setButtonText("管理密钥")
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

    new Setting(containerEl).setName("论文档案服务地址（可选）").addText((text) =>
      text.setPlaceholder(this.plugin.settings.bridgeUrl)
        .setValue(this.plugin.settings.dossierUrl ?? "").onChange(async (value) => {
          this.plugin.settings.dossierUrl = value.trim();
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
