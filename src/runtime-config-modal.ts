import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { ProviderDeclarationModal, renderProviderNotice } from "./provider-notice";

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

  constructor(
    app: App,
    private readonly host: RuntimeConfigurationHost,
    private readonly config: BridgeConfig,
    private readonly onSaved?: () => void,
    private readonly firstUse = false,
    private readonly onClosed?: () => void
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

  onClose(): void {
    this.contentEl.empty();
    this.onClosed?.();
  }

  private renderForm(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fkms-runtime-modal");
    const heading = contentEl.createDiv({ cls: "fkms-modal-heading" });
    heading.createEl("h2", { text: this.firstUse ? "首次使用 · 设置 LLM" : "回答模式" });
    const info = heading.createEl("button", {
      cls: "fkms-modal-info",
      attr: {
        type: "button",
        "aria-label": "LLM 接入声明",
        "data-tooltip-position": "left"
      }
    });
    setIcon(info.createSpan({ cls: "fkms-button-icon" }), "info");
    info.createSpan({ text: "声明" });
    info.onclick = () => new ProviderDeclarationModal(this.app, this.provider).open();

    new Setting(contentEl)
      .setName("分析方式")
      .setDesc("仅 LLM 直接回答；AuxBrain 会进一步校正证据与置信度。")
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
      })
      .addExtraButton((button) => button.setIcon("info").setTooltip("LLM 接入声明")
        .onClick(() => new ProviderDeclarationModal(this.app, this.provider).open()));

    const provider = findLlmProvider(this.config, this.provider);
    if (this.provider !== "deepseek") renderProviderNotice(contentEl, this.provider);
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
      text: provider?.configured ? "接口密钥 已配置" : "需要配置 接口密钥"
    });

    const actions = contentEl.createDiv({ cls: "fkms-modal-actions" });
    const keyButton = actions.createEl("button", {
      attr: { type: "button" }
    });
    const keyIcon = keyButton.createSpan({ cls: "fkms-button-icon" });
    setIcon(keyIcon, "key-round");
    keyButton.createSpan({ text: provider?.configured ? "更新密钥" : "配置密钥" });
    keyButton.onclick = async () => {
      keyButton.disabled = true;
      save.disabled = true;
      try {
        await this.saveSelection();
        this.close();
        this.openKeyConfiguration();
      } catch (error) {
        new Notice(`回答模式保存失败：${error instanceof Error ? error.message : String(error)}`);
        keyButton.disabled = false;
        save.disabled = false;
      }
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
      save.disabled = true;
      keyButton.disabled = true;
      try {
        await this.saveSelection();
        this.close();
        if (!provider?.configured) {
          this.openKeyConfiguration();
        }
      } catch (error) {
        new Notice(`回答模式保存失败：${error instanceof Error ? error.message : String(error)}`);
        save.disabled = false;
        keyButton.disabled = false;
      }
    };
  }

  private async saveSelection(): Promise<void> {
    const settings = this.host.getSettings();
    settings.analysisMode = this.mode;
    settings.llmProvider = this.provider;
    settings.llmModel = this.model;
    await this.host.saveSettings();
    this.onSaved?.();
  }

  private openKeyConfiguration(): void {
    this.host.openLlmConfiguration(
      this.provider,
      this.onSaved,
      () => void this.host.openRuntimeConfiguration(undefined, this.onSaved)
    );
  }
}
