import { App, Modal, Notice, Setting, setIcon } from "obsidian";

import { AuxBrainClient } from "./api";
import {
  AuxBrainSettings,
  LlmProvider,
  LlmProviderConfig,
  findLlmProvider
} from "./contracts";
import { friendlyError } from "./errors";

export interface LlmConfigurationHost {
  getSettings(): AuxBrainSettings;
  client(): AuxBrainClient;
}

export class LlmConfigurationModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private providerSpec: LlmProviderConfig | null = null;

  constructor(
    app: App,
    private readonly host: LlmConfigurationHost,
    private readonly provider: LlmProvider,
    private readonly onSaved?: () => void,
    private readonly onBack?: () => void
  ) {
    super(app);
  }

  onOpen(): void {
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
    contentEl.createEl("h2", { text: "AuxBrain · API Key" });
    this.statusEl = contentEl.createDiv({ cls: "fkms-llm-status" });
    this.setStatus("loading", "正在读取凭据状态");
    void this.loadProvider();
  }

  private async loadProvider(): Promise<void> {
    try {
      const config = await this.host.client().configuration();
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

    let apiKey = "";
    let keyInput!: HTMLInputElement;
    let visible = false;
    new Setting(form)
      .setName("API Key")
      .addText((text) => {
        keyInput = text.inputEl;
        keyInput.type = "password";
        text.setPlaceholder("输入 API Key").onChange((value) => {
          apiKey = value.trim();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("eye")
          .setTooltip("显示或隐藏 API Key")
          .onClick(() => {
            visible = !visible;
            keyInput.type = visible ? "text" : "password";
            button.setIcon(visible ? "eye-off" : "eye");
          })
      )
      .addButton((button) =>
        button
          .setButtonText("保存并测试")
          .setCta()
          .onClick(async () => {
            if (!apiKey) {
              new Notice("请输入 API Key");
              return;
            }
            button.setDisabled(true);
            this.setStatus("loading", "正在安全保存");
            try {
              await this.host.client().saveLlmCredential(this.provider, apiKey);
              keyInput.value = "";
              apiKey = "";
              this.onSaved?.();
              this.setStatus("loading", "正在测试连接");
              const result = await this.host
                .client()
                .testLlm(this.provider, this.host.getSettings().llmModel);
              this.setStatus("ok", `${result.provider} · ${result.model} · READY`);
              new Notice("LLM 连接成功");
            } catch (error) {
              this.setStatus("error", `保存或连接失败：${friendlyError(error)}`);
            } finally {
              button.setDisabled(false);
            }
          })
      );
  }

  private setStatus(state: string, message: string): void {
    if (!this.statusEl) return;
    this.statusEl.dataset.state = state;
    this.statusEl.setText(message);
  }
}
