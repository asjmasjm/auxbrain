import { setIcon } from "obsidian";
import { InsightsUnavailable, PaperEconomics } from "./dossier-insights";

function node<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "", cls = "") {
  const el = document.createElement(tag); el.textContent = text; el.className = cls; parent.append(el); return el;
}
export class PaperEconomicsPanel {
  private root: HTMLElement | null = null;
  private open = false;
  private busy = false;
  private disposed = false;
  private loaded = false;
  private unavailable = false;
  private error = "";
  private data: PaperEconomics | null = null;
  constructor(private workId: string, private read: (id: string) => Promise<PaperEconomics>) {}
  mount(root: HTMLElement) { this.root = root; this.render(); }
  dispose() { this.disposed = true; this.root = null; }
  private async load(recheck = false) {
    if (this.busy || this.disposed || this.unavailable && !recheck) return;
    this.busy = true; this.loaded = true; this.error = ""; this.data = null; this.render();
    try {
      const data = await this.read(this.workId);
      if (!this.disposed) { this.data = data; this.unavailable = false; }
    } catch (error) {
      if (!this.disposed) { this.unavailable = error instanceof InsightsUnavailable; this.error = error instanceof Error ? error.message : "用量读取失败"; }
    } finally { this.busy = false; this.render(); }
  }
  private render() {
    if (!this.root || this.disposed) return;
    this.root.replaceChildren();
    const details = node(this.root, "details", "", "ab-paper-economics"); details.open = this.open;
    node(details, "summary", "用量");
    details.ontoggle = () => {
      if (!details.isConnected) return;
      this.open = details.open;
      if (this.open && !this.loaded) void this.load();
    };
    if (this.busy) {
      const status = node(details, "div", "", "ab-library-status"); status.setAttribute("role", "status");
      setIcon(node(status, "span", "", "fkms-progress-stage-icon is-spinning"), "loader-circle"); node(status, "span", "正在读取已记录用量");
    }
    if (this.error) node(details, "p", this.error, "ab-library-error").setAttribute("role", "alert");
    const data = this.data;
    if (data && !data.trackingAvailable) node(details, "p", "当前数据库尚未启用成本记录", "ab-library-status");
    if (data?.trackingAvailable) {
      const totals = node(details, "dl", "", "ab-economics-values");
      const row = (label: string, value: string) => { node(totals, "dt", label); node(totals, "dd", value); };
      row("已记录令牌", data.total.toLocaleString("zh-CN"));
      const names: Record<string, string> = { answer: "问答令牌", organization: "整理令牌", audit: "审核令牌", legacy_organization: "历史整理令牌" };
      for (const key of new Set(["answer", "organization", "audit", ...Object.keys(data.stages)])) {
        row(names[key] || "其他阶段令牌", Object.prototype.hasOwnProperty.call(data.stages, key) ? data.stages[key].total.toLocaleString("zh-CN") : "未记录");
      }
      row("整理复用次数", String(data.reused));
    }
    if (data && (data.unknownCount > 0 || !data.complete)) node(details, "p", "部分用量未记录", "ab-library-status");
    if (data?.trackingAvailable) node(details, "p", "已记录令牌 不是完整账单；复用次数不代表节省金额", "ab-knowledge-meta");
    if (this.loaded) {
      const label = this.unavailable ? "更新服务后重试" : "刷新用量";
      const b = node(details, "button", "", "ab-library-button"); b.type = "button"; b.title = label; b.setAttribute("aria-label", label); b.disabled = this.busy;
      setIcon(node(b, "span", "", "fkms-button-icon"), "refresh-cw"); node(b, "span", label); b.onclick = () => void this.load(true);
    }
  }
}
