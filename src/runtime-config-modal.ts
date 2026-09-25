import { App, Modal, Notice, Setting, setIcon } from "obsidian";

import {
  AnalysisMode,
  AuxBrainSettings,
  BridgeConfig,
  LlmProvider,
  findLlmProvider,
  labelMode
} from "./contracts";

export interface RuntimeConfigurationHost {
  getSettings(): AuxBrainSettings;
  saveSettings(): Promise<void>;
  openLlmConfiguration(
    provider?: LlmProvider,
    onSaved?: () => void,
    onBack?: () => void
  ): void;
  openRuntimeConfiguration(config?: BridgeConfig, onSaved?: () => void): void;
}

export class RuntimeConfigurationModal extends Modal {
  private mode: AnalysisMode;
  private provider: LlmProvider;
  private model: string;
  private showProviderNote = false;

  constructor(
    app: App,
    private readonly host: RuntimeConfigurationHost,
    private readonly config: BridgeConfig,
    private readonly onSaved?: () => void
  ) {
    super(app);
    const settings = host.getSettings();
    this.mode = settings.analysisMode === "algorithm" ? "hybrid" : settings.analysisMode;
    this.provider = settings.llmProvider;
    this.model = settings.llmModel;
  }

  onOpen(): void {
    this.renderForm();
  }

  private renderForm(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fkms-runtime-modal");
    const heading = contentEl.createDiv({ cls: "fkms-modal-heading" });
    heading.createEl("h2", { text: "回答模式" });
    const info = heading.createEl("button", {
      cls: "clickable-icon fkms-modal-info",
      attr: {
        type: "button",
        "aria-label": "LLM 服务支持说明",
        "aria-expanded": String(this.showProviderNote),
        "data-tooltip-position": "left"
      }
    });
    setIcon(info, "info");
    info.onclick = () => {
      this.showProviderNote = !this.showProviderNote;
      this.renderForm();
    };
    if (this.showProviderNote) {
      const note = contentEl.createDiv({ cls: "fkms-provider-note" });
      const noteIcon = note.createSpan({ cls: "fkms-provider-note-icon" });
      setIcon(noteIcon, "info");
      note.createSpan({
        text: "目前仅支持 DeepSeek 官网 API 和火山引擎 Coding Plan，更多 LLM 服务有待支持。"
      });
    }

    new Setting(contentEl)
      .setName("分析方式")
      .setDesc("LLM-Only 直接回答；AuxBrain 会进一步校正证据与置信度。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("llm", labelMode("llm"))
          .addOption("hybrid", labelMode("hybrid"))
          .setValue(this.mode)
          .onChange((value) => {
            this.mode = value as AnalysisMode;
          })
      );

    new Setting(contentEl)
      .setName("LLM 供应商")
      .addDropdown((dropdown) => {
        for (const provider of this.config.llm.providers) {
          dropdown.addOption(provider.id, provider.name);
        }
        dropdown.setValue(this.provider).onChange((value) => {
          this.provider = value as LlmProvider;
          this.model =
            findLlmProvider(this.config, this.provider)?.default_model ?? "";
          this.renderForm();
        });
      });

    const provider = findLlmProvider(this.config, this.provider);
    new Setting(contentEl)
      .setName("模型")
      .addDropdown((dropdown) => {
        for (const model of provider?.models ?? []) {
          dropdown.addOption(model.id, model.name);
        }
        dropdown.setValue(this.model).onChange((value) => {
          this.model = value;
        });
      });

    const status = contentEl.createDiv({ cls: "fkms-runtime-modal-status" });
    status.dataset.state = provider?.configured ? "ok" : "warning";
    status.createSpan({ cls: "fkms-status-dot" });
    status.createSpan({
      text: provider?.configured ? "API Key 已配置" : "需要配置 API Key"
    });

    const actions = contentEl.createDiv({ cls: "fkms-modal-actions" });
    const keyButton = actions.createEl("button", {
      attr: { type: "button" }
    });
    const keyIcon = keyButton.createSpan({ cls: "fkms-button-icon" });
    setIcon(keyIcon, "key-round");
    keyButton.createSpan({ text: provider?.configured ? "更新 Key" : "配置 Key" });
    keyButton.onclick = () => {
      this.close();
      this.openKeyConfiguration();
    };

    const cancel = actions.createEl("button", {
      text: "取消",
      attr: { type: "button" }
    });
    cancel.onclick = () => this.close();

    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" }
    });
    save.onclick = async () => {
      const settings = this.host.getSettings();
      settings.analysisMode = this.mode;
      settings.llmProvider = this.provider;
      settings.llmModel = this.model;
      save.disabled = true;
      try {
        await this.host.saveSettings();
        this.onSaved?.();
        this.close();
        if (!provider?.configured) {
          this.openKeyConfiguration();
        }
      } catch (error) {
        new Notice(`回答模式保存失败：${error instanceof Error ? error.message : String(error)}`);
        save.disabled = false;
      }
    };
  }

  private openKeyConfiguration(): void {
    this.host.openLlmConfiguration(
      this.provider,
      this.onSaved,
      () => void this.host.openRuntimeConfiguration(undefined, this.onSaved)
    );
  }
}
