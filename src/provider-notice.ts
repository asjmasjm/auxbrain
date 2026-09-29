import { App, Modal, setIcon } from "obsidian";
import { LlmProvider } from "./contracts";

const POLICIES: Record<LlmProvider, { name: string; text: string; href: string }> = {
  deepseek: {
    name: "DeepSeek 官网 API",
    text: "开放平台允许开发下游应用，仍须遵守服务协议及数据使用要求。按账户规则消耗额度或余额。",
    href: "https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html"
  },
  "volcengine-ark": {
    name: "火山 Coding Plan",
    text: "AuxBrain 论文问答及后台整理的套餐适用范围尚待官方确认。当前不是普通后付费 API，不会自动切换计费接口。",
    href: "https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh"
  },
  "tencent-token-plan": {
    name: "腾讯云 Token Plan",
    text: "官方个人版条款明确禁止用于自定义应用程序后端、自动化脚本及非交互式批量调用。AuxBrain 使用本地 Companion 后端，不能据此认定为允许场景；未经腾讯确认授权，不应使用该套餐运行此工作流。声明和用户选择均不替代服务商授权。可能存在暂停订阅或封禁密钥 的风险。",
    href: "https://cloud.tencent.com/document/product/1823/130060"
  }
};

export function renderProviderNotice(parent: HTMLElement, provider: LlmProvider): void {
  const note = parent.createDiv({ cls: "fkms-provider-policy" });
  const policy = POLICIES[provider];
  note.createEl("p", { text: `${policy.name}：${policy.text}` });
  note.createEl("a", {
    text: `${policy.name}官方说明`,
    attr: { href: policy.href,
      target: "_blank", rel: "noopener noreferrer" }
  });
}

export class ProviderDeclarationModal extends Modal {
  constructor(app: App, private readonly selected: LlmProvider) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fkms-runtime-modal", "fkms-provider-declaration");
    const nav = contentEl.createDiv({ cls: "fkms-back-navigation" });
    const back = nav.createEl("button", { attr: { type: "button", "aria-label": "返回 LLM 设置" } });
    setIcon(back.createSpan({ cls: "fkms-button-icon" }), "arrow-left");
    back.createSpan({ text: "返回 LLM 设置" });
    back.onclick = () => this.close();
    contentEl.createEl("h2", { text: "LLM 接入声明" });
    contentEl.createEl("p", { text: `当前选择：${POLICIES[this.selected].name}` });
    for (const provider of Object.keys(POLICIES) as LlmProvider[]) renderProviderNotice(contentEl, provider);
    contentEl.createEl("p", { text: "论文相关正文、问题和标注内容会发送至所选服务商。保存密钥 只写入本机；测试连接和提问会调用模型并消耗额度。请使用自己的密钥，并确认对论文内容拥有相应的数据使用权限。" });
    contentEl.createEl("p", { text: "各家套餐、模型和账户权限不同，以下拉列表及服务商控制台为准。Auto/latest 可能由服务商更换底层模型。不会自动跨供应商或改用后付费接口；此处不包含腾讯 TokenHub 普通按量 API。" });
    contentEl.createEl("p", { text: "后台论文档案整理的 --dossier-llm 为独立开关，启用后调用 DeepSeek，不随前台供应商切换。默认后台摘录整理在本地运行。" });
    contentEl.createEl("p", { text: "核对日期：2026-09-28。条款可能更新，请以官方最新规则及书面授权为准。关闭声明不会修改当前设置。" });
  }

  onClose(): void { this.contentEl.empty(); }
}
