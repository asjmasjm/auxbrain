import { setIcon } from "obsidian";
import { InsightsUnavailable, KnowledgeHit, KnowledgeSearchPage } from "./dossier-insights";
import { renderKnowledgeText, scopeRows } from "./paper-knowledge-presentation";
import type { PaperEvidence } from "./paper-library-contracts";

function node<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "", cls = "") {
  const el = document.createElement(tag); el.textContent = text; el.className = cls; parent.append(el); return el;
}
function action(parent: HTMLElement, label: string, icon: string, run: () => void, iconOnly = false) {
  const b = node(parent, "button", "", iconOnly ? "ab-library-icon" : "ab-library-button"); b.type = "button";
  b.title = label; b.setAttribute("aria-label", label); setIcon(node(b, "span", "", "fkms-button-icon"), icon);
  if (!iconOnly) node(b, "span", label); b.onclick = run; return b;
}
export class PaperKnowledgeSearch {
  private root: HTMLElement | null = null;
  private draft = "";
  private query = "";
  private page: KnowledgeSearchPage | null = null;
  private busy = false;
  private unavailable = false;
  private error = "";
  private epoch = 0;
  private disposed = false;
  private dirty = false;
  constructor(private read: (q: string, offset: number) => Promise<KnowledgeSearchPage>, private callbacks: {
    open(workId: string): void; evidence(hit: KnowledgeHit, source: PaperEvidence): Promise<void>; availability(available: boolean): void;
  }) {}
  mount(root: HTMLElement) {
    this.root = root;
    if (this.dirty && this.query && !this.unavailable) { this.dirty = false; void this.search(this.query, this.page?.offset ?? 0); }
    else this.render();
  }
  invalidate() { this.dirty = true; }
  suspend() { this.root = null; this.epoch++; this.busy = false; }
  dispose() { this.disposed = true; this.suspend(); }
  resetAvailability() { this.unavailable = false; this.error = ""; this.callbacks.availability(true); this.render(); }
  private async search(query: string, offset = 0) {
    if (this.disposed || this.busy || this.unavailable) return;
    query = query.trim();
    if (!query) { this.error = "请输入检索关键词"; this.render(); return; }
    const epoch = ++this.epoch; this.busy = true; this.error = ""; this.page = null; this.query = query; this.render();
    try {
      const page = await this.read(query, offset);
      if (!this.disposed && epoch === this.epoch) this.page = page;
    } catch (error) {
      if (!this.disposed && epoch === this.epoch) {
        this.error = error instanceof Error ? error.message : "知识检索失败";
        if (error instanceof InsightsUnavailable) { this.unavailable = true; this.callbacks.availability(false); }
      }
    } finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  private async navigate(hit: KnowledgeHit, source: PaperEvidence) {
    const epoch = this.epoch;
    try { await this.callbacks.evidence(hit, source); }
    catch (error) { if (!this.disposed && epoch === this.epoch) { this.error = error instanceof Error ? error.message : "原文定位失败"; this.render(); } }
  }
  private render() {
    if (!this.root || this.disposed) return;
    this.root.replaceChildren();
    const root = node(this.root, "section", "", "ab-knowledge-search");
    node(root, "h3", "跨论文知识检索");
    const form = node(root, "form", "", "ab-insights-search-form"); form.setAttribute("role", "search");
    const input = node(form, "input"); input.type = "search"; input.placeholder = "检索已确认知识"; input.setAttribute("aria-label", "检索已确认知识");
    input.value = this.draft; input.maxLength = 4000; input.disabled = this.unavailable;
    input.oninput = () => { this.draft = input.value; };
    action(form, "提交知识检索", "search", () => void this.search(this.draft), true).disabled = this.busy || this.unavailable;
    form.onsubmit = event => { event.preventDefault(); void this.search(this.draft); };
    if (this.error) node(root, "p", this.error, "ab-library-error").setAttribute("role", "alert");
    if (this.unavailable) action(root, "更新服务后重试", "refresh-cw", () => { this.resetAvailability(); void this.search(this.draft); });
    if (this.busy) {
      const status = node(root, "div", "", "ab-library-status"); status.setAttribute("role", "status");
      setIcon(node(status, "span", "", "fkms-progress-stage-icon is-spinning"), "loader-circle"); node(status, "span", "正在检索已确认知识");
    }
    const page = this.page; if (!page) return;
    node(root, "p", `“${this.query}” · ${page.total} 条已确认知识 · ${page.relatedWorks} 篇论文`, "ab-library-total");
    if (!page.items.length) node(root, "p", "未找到匹配的已确认知识", "ab-library-empty");
    const groups = new Map<string, KnowledgeHit[]>();
    for (const hit of page.items) { const group = groups.get(hit.workId) ?? []; group.push(hit); groups.set(hit.workId, group); }
    for (const [workId, hits] of groups) {
      const group = node(root, "section", "", "ab-search-paper"); node(group, "h4", hits[0].title);
      action(group, "打开论文卡片", "file-text", () => this.callbacks.open(workId));
      for (const hit of hits) {
        const entry = node(group, "div", "", "ab-knowledge-entry");
        if (hit.title !== hits[0].title) node(entry, "p", hit.title, "ab-knowledge-meta");
        renderKnowledgeText(entry, hit.statement);
        node(entry, "h5", "适用条件");
        if (!scopeRows(hit.scope).length) node(entry, "p", "未记录适用条件", "ab-knowledge-meta");
        else {
          const scope = node(entry, "dl", "", "ab-insights-scope");
          for (const row of scopeRows(hit.scope)) {
            node(scope, "dt", row.label);
            node(scope, "dd", row.value);
          }
        }
        const evidence = node(entry, "details"); node(evidence, "summary", `原文依据（${hit.evidence.length} 处）`);
        for (const source of hit.evidence) {
          node(evidence, "blockquote", source.text);
          const canLocate = source.location_status === "locatable" && !!source.source_path && !!source.locator.kind;
          action(evidence, source.location_label ? `跳转原文 · ${source.location_label}` : "跳转原文", "locate-fixed", () => void this.navigate(hit, source)).disabled = !canLocate;
          if (!canLocate) node(evidence, "p", source.location_status === "source_changed" ? "原文已变化，待核对" : source.location_status === "ambiguous" ? "原文位置不唯一" : "尚未关联本地原文位置", "ab-knowledge-meta");
        }
      }
    }
    const pages = node(root, "div", "", "ab-insights-pagination");
    action(pages, "上一页知识", "chevron-left", () => void this.search(this.query, Math.max(0, page.offset - page.limit)), true).disabled = this.busy || page.offset === 0;
    node(pages, "span", `${page.items.length ? page.offset + 1 : 0}–${page.items.length ? page.offset + page.items.length : 0} / ${page.total}`);
    action(pages, "下一页知识", "chevron-right", () => void this.search(this.query, page.offset + page.limit), true).disabled = this.busy || page.offset + page.limit >= page.total;
  }
}
