import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";

import { AuxBrainClient } from "./api";
import {
  AuxBrainSettings,
  LlmProvider,
  LlmProviderConfig,
  findLlmProvider
} from "./contracts";
import { friendlyError } from "./errors";
import { ProviderDeclarationModal, renderProviderNotice } from "./provider-notice";

export interface LlmConfigurationHost {
  getSettings(): AuxBrainSettings;
  client(): AuxBrainClient;
}

export class LlmConfigurationModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private providerSpec: LlmProviderConfig | null = null;
  private closed = false;

  constructor(
    app: App,
    private readonly host: LlmConfigurationHost,
    private readonly provider: LlmProvider,
    private readonly onSaved?: () => void,
    private readonly onBack?: () => void,
    private readonly onClosed?: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.closed = false;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fkms-llm-modal");
    if (this.onBack) {
      const navigation = contentEl.createDiv({ cls: "fkms-back-navigation" });
      const back = navigation.createEl("button", {
        attr: { type: "button", "aria-label": "返回回答模式" }
      });
      const icon = back.createSpan({ cls: "fkms-button-icon" });
      setIcon(icon, "arrow-left");
      back.createSpan({ text: "返回回答模式" });
      back.onclick = () => {
        this.close();
        this.onBack?.();
      };
    }
    contentEl.createEl("h2", { text: "AuxBrain · 接口密钥" });
    this.statusEl = contentEl.createDiv({ cls: "fkms-llm-status" });
    this.setStatus("loading", "正在读取凭据状态");
    void this.loadProvider();
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
    this.onClosed?.();
  }

  private async loadProvider(): Promise<void> {
    try {
      const config = await this.host.client().configuration();
      if (this.closed) return;
      this.providerSpec = findLlmProvider(config, this.provider) ?? null;
      if (!this.providerSpec) throw new Error("找不到所选 LLM 提供商");
      this.renderForm();
      if (this.providerSpec.credential_error) {
        this.setStatus("error", `凭据读取失败：${this.providerSpec.credential_error}`);
      } else {
        this.setStatus(
          this.providerSpec.configured ? "ok" : "warning",
          this.providerSpec.configured ? "密钥已配置" : "等待首次配置"
        );
      }
    } catch (error) {
      this.setStatus("error", `本地服务不可用：${friendlyError(error)}`);
    }
  }

  private renderForm(): void {
    if (!this.providerSpec) return;
    const form = this.contentEl.createDiv({ cls: "fkms-key-form" });
    const identity = form.createDiv({ cls: "fkms-key-identity" });
    identity.createSpan({ text: this.providerSpec.name });
    identity.createEl("code", { text: this.host.getSettings().llmModel });
    const declaration = identity.createEl("button", { attr: { type: "button", "aria-label": "LLM 接入声明" } });
    setIcon(declaration.createSpan({ cls: "fkms-button-icon" }), "info");
    declaration.createSpan({ text: "声明" });
    declaration.onclick = () => new ProviderDeclarationModal(this.app, this.provider).open();
    renderProviderNotice(form, this.provider);
    form.createEl("p", { text: "保存密钥 仅写入本机凭据存储；测试连接会发送一条简短测试提示，可能消耗供应商额度，不发送论文。" });

    let apiKey = "";
    let keyInput!: HTMLInputElement;
    let visible = false;
    let busy = false;
    let stored = this.providerSpec.configured;
    let saveButton: ButtonComponent;
    let testButton: ButtonComponent;
    const updateButtons = () => {
      saveButton?.setDisabled(busy || !apiKey);
      testButton?.setDisabled(busy || !stored || !!apiKey);
      keyInput.disabled = busy;
    };
    new Setting(form)
      .setName("接口密钥")
      .addText((text) => {
        keyInput = text.inputEl;
        keyInput.type = "password";
        text.setPlaceholder("输入 接口密钥").onChange((value) => {
          apiKey = value.trim();
          updateButtons();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("eye")
          .setTooltip("显示或隐藏 接口密钥")
          .onClick(() => {
            visible = !visible;
            keyInput.type = visible ? "text" : "password";
            button.setIcon(visible ? "eye-off" : "eye");
          })
      )
      .addButton((button) => {
        saveButton = button;
        button
          .setButtonText("保存密钥")
          .setCta()
          .onClick(async () => {
            if (busy || this.closed) return;
            if (!apiKey) {
              new Notice("请输入 接口密钥");
              return;
            }
            busy = true;
            updateButtons();
            this.setStatus("loading", "正在安全保存");
            try {
              await this.host.client().saveLlmCredential(this.provider, apiKey);
              keyInput.value = "";
              apiKey = "";
              stored = true;
              this.onSaved?.();
              this.setStatus("ok", "密钥已安全保存，尚未测试连接");
            } catch (error) {
              this.setStatus("error", `保存失败：${friendlyError(error)}`);
            } finally {
              busy = false;
              updateButtons();
            }
          });
      })
      .addButton((button) => {
        testButton = button;
        button.setButtonText("测试连接").onClick(async () => {
          if (busy || !stored || apiKey || this.closed) return;
          busy = true;
          updateButtons();
          this.setStatus("loading", "正在测试连接");
          try {
            const result = await this.host.client().testLlm(this.provider, this.host.getSettings().llmModel);
            this.setStatus("ok", `${result.provider} · ${result.model} · READY`);
            if (!this.closed) new Notice("LLM 连接成功");
          } catch (error) {
            this.setStatus("error", `连接失败：${friendlyError(error)}`);
          } finally {
            busy = false;
            updateButtons();
          }
        });
      });
    updateButtons();
  }

  private setStatus(state: string, message: string): void {
    if (this.closed || !this.statusEl) return;
    this.statusEl.dataset.state = state;
    this.statusEl.setText(message);
  }
}
