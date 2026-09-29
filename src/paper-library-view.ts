import { setIcon } from "obsidian";
import { PaperReviewPanel } from "./paper-review-panel";
import { PaperKnowledgeSearch } from "./paper-knowledge-search";
import { PaperEconomicsPanel } from "./paper-economics-panel";
import { isSourceExcerpt, knowledgeLabel, sourcePreview, renderKnowledgeText, contributionGroups } from "./paper-knowledge-presentation";
import { labelPolarity, labelRelation } from "./contracts";
import { importedRelationStatement, renderKnowledgeRelation } from "./knowledge-relation";
import {
  PAPER_SECTIONS, PaperCard, PaperDetail, PaperEvidence, PaperLibraryDataSource,
  PaperPage, PaperSectionKey, QuestionContribution, SectionStatus
} from "./paper-library-contracts";

const statuses: Record<SectionStatus, string> = {
  unexplored: "尚未探索", candidate: "待处理", partial: "部分确认", confirmed: "已确认", conflict: "存在冲突", not_reported: "原文未明确报告", stale: "原文已变更，待复核"
};
const changes = { added: "新增", supported: "补充证据", corrected: "修正", withdrawn: "撤回", revealed: "首次披露", unchanged: "无新增", confirmed: "确认", conflict: "冲突" };
export function paperProgress(paper: PaperCard): string {
  const questions = paper.counts.questions === null ? "提问次数待同步" : `已提问 ${paper.counts.questions} 次`;
  const pending = paper.counts.candidate === null ? "待确认知识数量待同步" : `${paper.counts.candidate} 条知识待入库确认`;
  return `${questions}，${pending}`;
}
function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; parent.appendChild(node); return node;
}
function button(parent: HTMLElement, icon: string, label: string, action: () => void, iconOnly = false): HTMLButtonElement {
  const b = el(parent, "button", iconOnly ? "ab-library-icon" : "ab-library-button");
  b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
  setIcon(el(b, "span", "fkms-button-icon"), icon);
  if (!iconOnly) el(b, "span", "", label);
  b.onclick = action; return b;
}
function date(value: string | null): string {
  if (!value) return "待补充";
  // SQLite timestamps are UTC; date-only bibliographic values retain their precision.
  if (/^\d{4}(-\d{2}){0,2}$/.test(value)) return value;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}
export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
function link(parent: HTMLElement, label: string, href: string | null): void {
  const safe = safeExternalUrl(href);
  if (!safe) { el(parent, "span", "", label); return; }
  const a = el(parent, "a", "ab-library-link", label); a.href = safe; a.target = "_blank"; a.rel = "noopener noreferrer";
}

export class PaperLibraryView {
  private root: HTMLElement | null = null;
  private page: PaperPage | null = null;
  private paper: PaperDetail | null = null;
  private selectedId: string | null = null;
  private query = "";
  private sort: "updated" | "title" = "updated";
  private tab: "knowledge" | "metadata" | "contributions" = "knowledge";
  private loading = false;
  private error = "";
  private initialized = false;
  private disposed = false;
  private epoch = 0;
  private focusSection: PaperSectionKey | null = null;
  private expanded = new Set<string>();
  private expandedEvidence = new Set<string>();
  private retry: (() => void) | null = null;
  private reviewPanel: PaperReviewPanel | null = null;
  private binding = false;
  private searching = false;
  private searchAvailable = true;
  private searchPanel: PaperKnowledgeSearch | null = null;
  private economicsPanel: PaperEconomicsPanel | null = null;
  private bindingPhase = "";
  private bindingFeedback: { kind: "success" | "warning" | "error"; title: string; detail: string;
    paper: PaperCard; source: PaperEvidence; located?: PaperEvidence } | null = null;
  constructor(private client: PaperLibraryDataSource, private callbacks: {
    back(): void; legacyGraph(paper?: PaperCard): void; evidence(paper: Pick<PaperCard, "paper_id" | "title">, evidence: PaperEvidence): Promise<void>;
    reviewer?(): string; reviewSession?(active: boolean): void; canReview?(): boolean;
    bindEvidence?(paper: PaperCard, evidence: PaperEvidence): Promise<void>;
    notify?(message: string): void;
  }) {}
  mount(root: HTMLElement): void {
    this.root = root; this.render();
    if (!this.initialized) { this.initialized = true; void this.refresh(); }
  }
  dispose(): void { this.disposed = true; this.epoch++; this.root = null; this.reviewPanel?.dispose(); this.searchPanel?.dispose(); this.economicsPanel?.dispose();
    if (this.reviewPanel || this.binding) this.callbacks.reviewSession?.(false); this.reviewPanel = null; }
  async refresh(): Promise<void> {
    if (this.reviewPanel || this.binding || this.disposed) return;
    this.initialized = true;
    if (this.selectedId) return this.openPaper(this.selectedId);
    if (this.searching) return;
    return this.loadList(false);
  }
  private async loadList(append: boolean): Promise<void> {
    const cursor = append ? this.page?.next_cursor : undefined;
    if (append && (!cursor || this.loading)) return;
    const epoch = ++this.epoch;
    this.selectedId = null; this.paper = null; this.loading = true; this.error = ""; this.render();
    try {
      const next = await this.client.list(this.query, this.sort, cursor ?? undefined);
      if (!this.active(epoch)) return;
      if (append && this.page && next.mode === this.page.mode) {
        const map = new Map(this.page.papers.map(p => [p.paper_id, p]));
        next.papers.forEach(p => map.set(p.paper_id, p));
        next.papers = [...map.values()];
        if (next.next_cursor === cursor) throw new Error("分页游标未前进，请刷新论文列表");
      }
      this.page = next;
    } catch (error) {
      if (this.active(epoch)) { this.error = this.message(error); this.retry = () => void this.loadList(append); }
    } finally { if (this.active(epoch)) { this.loading = false; this.render(); } }
  }
  async openPaper(id: string): Promise<void> {
    this.searchPanel?.suspend();
    this.economicsPanel?.dispose();
    this.economicsPanel = this.client.economics ? new PaperEconomicsPanel(id, workId => this.client.economics!(workId)) : null;
    if (this.selectedId !== id) { this.expanded.clear(); this.expandedEvidence.clear(); this.focusSection = null; this.bindingFeedback = null; }
    const epoch = ++this.epoch;
    this.selectedId = id; this.paper = null; this.loading = true; this.error = ""; this.render();
    try {
      const paper = await this.client.detail(id);
      if (this.active(epoch)) {
        this.paper = paper;
        if (this.page) this.page.papers = this.page.papers.map(row => row.paper_id === id ? paper : row);
      }
    } catch (error) {
      if (this.active(epoch)) { this.error = this.message(error); this.retry = () => void this.openPaper(id); }
    } finally { if (this.active(epoch)) { this.loading = false; this.render(); } }
  }
  private async moreContributions(): Promise<void> {
    const paper = this.paper, cursor = paper?.contributions.next_cursor;
    if (!paper || !cursor || this.loading) return;
    const epoch = ++this.epoch; this.loading = true; this.error = ""; this.render();
    try {
      const next = await this.client.contributions(paper.paper_id, cursor);
      if (!this.active(epoch)) return;
      if (next.next_cursor === cursor) throw new Error("问题分页游标未前进，请刷新后重试");
      const map = new Map(paper.contributions.contributions.map(c => [c.understanding_id, c]));
      next.contributions.forEach(c => map.set(c.understanding_id, c));
      paper.contributions = { contributions: [...map.values()], next_cursor: next.next_cursor };
    } catch (error) {
      if (this.active(epoch)) { this.error = this.message(error); this.retry = () => void this.moreContributions(); }
    } finally { if (this.active(epoch)) { this.loading = false; this.render(); } }
  }
  private async moreItems(): Promise<void> {
    const paper = this.paper, cursor = paper?.items_page?.next_cursor;
    if (!paper || !cursor || !this.client.items || this.loading) return;
    const epoch = ++this.epoch; this.loading = true; this.error = ""; this.render();
    try {
      const page = await this.client.items(paper.paper_id, cursor);
      if (!this.active(epoch)) return;
      if (page.next_cursor === cursor) throw new Error("知识分页游标未前进，请刷新后重试");
      for (const incoming of page.sections) {
        const section = paper.sections.find(s => s.key === incoming.key);
        if (!section) continue;
        const items = new Map(section.items.map(i => [i.item_id, i]));
        incoming.items.forEach(i => items.set(i.item_id, i)); section.items = [...items.values()];
      }
      paper.items_page = { loaded: paper.sections.reduce((n, s) => n + s.items.length, 0), total: page.total, next_cursor: page.next_cursor };
    } catch (error) {
      if (this.active(epoch)) { this.error = this.message(error); this.retry = () => void this.moreItems(); }
    } finally { if (this.active(epoch)) { this.loading = false; this.render(); } }
  }
  private active(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }
  private message(error: unknown): string { return error instanceof Error ? error.message : "论文档案读取失败"; }
  private back(): void {
    if (this.binding) return;
    this.bindingFeedback = null;
    this.economicsPanel?.dispose(); this.economicsPanel = null;
    this.epoch++; this.loading = false; this.error = "";
    if (!this.selectedId) {
      if (this.searching) { this.searching = false; this.searchPanel?.suspend(); this.render(); return; }
      this.callbacks.back(); return;
    }
    this.selectedId = null; this.paper = null; this.focusSection = null; this.tab = "knowledge"; this.expanded.clear(); this.render();
  }
  private render(): void {
    if (!this.root || this.disposed) return;
    if (this.reviewPanel) { this.root.replaceChildren(); this.reviewPanel.mount(this.root); return; }
    this.root.replaceChildren();
    const root = el(this.root, "div", "ab-library");
    const nav = el(root, "div", "fkms-back-navigation ab-library-navigation");
    button(nav, "arrow-left", this.selectedId ? (this.searching ? "返回检索结果" : "返回论文列表") : this.searching ? "返回论文列表" : "返回主菜单", () => this.back());
    button(nav, "network", this.paper ? "查看本篇论文知识图谱" : "查看全部论文知识图谱", () => this.callbacks.legacyGraph(this.paper ?? undefined), true).disabled = !!this.selectedId && !this.paper;
    if (this.binding) {
      nav.querySelectorAll("button").forEach(b => b.disabled = true);
      const status = el(root, "div", "ab-library-status"); status.setAttribute("role", "status");
      setIcon(el(status, "span", "fkms-progress-stage-icon is-spinning"), "loader-circle");
      el(status, "span", "", this.bindingPhase);
      return;
    }
    if (this.bindingFeedback) {
      const feedback = this.bindingFeedback;
      const result = el(root, "section", `ab-binding-result is-${feedback.kind}`);
      result.setAttribute("role", feedback.kind === "error" ? "alert" : "status");
      const heading = el(result, "div", "ab-binding-result-heading");
      setIcon(el(heading, "span", "fkms-button-icon"), feedback.kind === "success" ? "circle-check" : "triangle-alert");
      el(heading, "strong", "", feedback.title);
      button(heading, "x", "关闭关联结果提示", () => { this.bindingFeedback = null; this.render(); }, true);
      el(result, "p", "", feedback.detail);
      const actions = el(result, "div", "ab-knowledge-actions");
      if (feedback.located) button(actions, "locate-fixed", "跳转已关联原文", () => void this.openEvidence(feedback.paper, feedback.located!));
      else button(actions, "refresh-cw", "重新核对结果", () => void this.bindEvidence(feedback.paper, feedback.source, true)).disabled = this.loading;
    }
    if (this.error) {
      const error = el(root, "div", "ab-library-error", this.error); error.setAttribute("role", "alert");
      button(error, "rotate-cw", "重试", () => this.retry?.());
    }
    if (this.loading) {
      const state = el(root, "div", "ab-library-status", ""); state.setAttribute("role", "status");
      setIcon(el(state, "span", "fkms-button-icon is-spinning"), "loader-circle"); el(state, "span", "", "正在读取论文档案");
    }
    if (this.selectedId) { if (this.paper) this.renderDetail(root, this.paper); return; }
    if (this.searching && this.searchPanel) { this.searchPanel.mount(el(root, "div")); return; }
    this.renderList(root);
  }
  private openSearch(): void {
    if (!this.client.searchKnowledge) return;
    if (!this.searchPanel) this.searchPanel = new PaperKnowledgeSearch((q, offset) => this.client.searchKnowledge!(q, offset), {
      open: id => { void this.openPaper(id); },
      evidence: (hit, source) => this.callbacks.evidence({ paper_id: hit.workId, title: hit.title }, source),
      availability: available => { this.searchAvailable = available; }
    });
    this.epoch++; this.loading = false; this.error = ""; this.searching = true; this.render();
  }
  private renderList(root: HTMLElement): void {
    const discovery = el(root, "div", "ab-knowledge-actions");
    button(discovery, "scan-search", "跨论文知识检索", () => this.openSearch()).disabled = !this.client.searchKnowledge || !this.searchAvailable;
    if (!this.searchAvailable) {
      el(root, "p", "ab-library-status", "知识检索不可用，请更新并重启本地服务");
      button(discovery, "refresh-cw", "更新服务后重试", () => { this.searchPanel?.resetAvailability(); this.openSearch(); });
    }
    const toolbar = el(root, "form", "ab-library-toolbar"); toolbar.setAttribute("role", "search");
    const input = el(toolbar, "input"); input.type = "search"; input.placeholder = "搜索论文"; input.value = this.query;
    input.setAttribute("aria-label", "搜索论文");
    const sort = el(toolbar, "select"); sort.setAttribute("aria-label", "论文排序");
    for (const [value, name] of [["updated", "最近更新"], ["title", "论文标题"]]) { const option = el(sort, "option", "", name); option.value = value; }
    sort.value = this.sort;
    if (this.page?.sorting === false) {
      sort.disabled = true;
      sort.options[0].textContent = "后端顺序";
      sort.value = "updated";
      sort.title = "当前档案接口尚未提供排序参数";
    }
    const submit = () => { this.query = input.value.trim(); this.sort = sort.value as "updated" | "title"; void this.loadList(false); };
    button(toolbar, "search", "搜索", submit, true).disabled = this.loading;
    toolbar.onsubmit = event => { event.preventDefault(); submit(); }; sort.onchange = submit;
    if (!this.page) return;
    if (this.page.mode === "legacy") {
      el(root, "p", "ab-library-status", "论文档案服务未就绪 · 当前仅显示已确认关系");
      const limit = this.page.legacy_limit;
      if (limit && limit.shown < limit.total) el(root, "p", "ab-library-status", `已载入 ${limit.shown} / ${limit.total} 条关系，论文列表可能不完整`);
    }
    el(root, "div", "ab-library-total", `${this.page.total} 篇论文`);
    if (!this.page.papers.length) el(root, "p", "ab-library-empty", this.query ? "没有匹配的论文" : "尚未建立论文档案");
    const grid = el(root, "div", "ab-paper-grid");
    for (const paper of this.page.papers) {
      const card = el(grid, "button", "ab-paper-card"); card.type = "button"; card.disabled = this.loading;
      card.setAttribute("aria-label", `查看论文：${paper.title}`);
      const top = el(card, "span", "ab-paper-card-top"); setIcon(el(top, "span", "fkms-button-icon"), "file-text");
      el(top, "span", "", this.publication(paper));
      el(card, "span", "ab-paper-card-title", paper.title);
      el(card, "span", "ab-paper-card-authors", paper.metadata.authors.map(a => a.name).join(" · ") || "作者待补充");
      const institutions = [...new Set(paper.metadata.authors.flatMap(a => a.affiliations))];
      el(card, "span", "ab-paper-card-institutions", institutions.join(" · ") || "机构待补充");
      const counts = el(card, "span", "ab-paper-card-counts");
      el(counts, "span", "", `已确认 ${paper.counts.confirmed}`);
      el(card, "span", "ab-paper-card-coverage", paperProgress(paper));
      el(card, "span", "ab-paper-card-coverage", paper.counts.explored_sections === null ? "知识披露待整理" : `已探索 ${paper.counts.explored_sections} / ${Object.keys(PAPER_SECTIONS).length} 个维度`);
      const foot = el(card, "span", "ab-paper-card-foot");
      if (paper.question_count_scope === "dossier_linked") el(foot, "span", "", "提问次数：已关联本论文档案");
      el(foot, "span", "", paper.updated_at ? date(paper.updated_at) : "暂无更新记录");
      card.onclick = () => { this.tab = "knowledge"; this.expanded.clear(); void this.openPaper(paper.paper_id); };
    }
    if (this.page.next_cursor) button(root, "chevron-down", "更多论文", () => void this.loadList(true)).disabled = this.loading;
  }
  private publication(paper: PaperCard): string {
    const p = paper.metadata.publication;
    const label = { unknown: "发表信息待核实", preprint: "预印本", accepted: "已接收", published: "已发表" }[p.status];
    return p.venue ? `${label} · ${p.venue}` : label;
  }
  private renderDetail(root: HTMLElement, paper: PaperDetail): void {
    const heading = el(root, "header", "ab-paper-heading");
    el(heading, "h3", "", paper.title); el(heading, "p", "", this.publication(paper));
    el(heading, "p", "", paperProgress(paper));
    const tabs = el(root, "div", "ab-library-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "论文档案视图");
    const tabItems = [["knowledge", "结构化知识"], ["metadata", "基本信息"], ["contributions", "提问贡献"]] as const;
    const tabButtons: HTMLButtonElement[] = [];
    tabItems.forEach(([key, title], index) => {
      const b = el(tabs, "button", this.tab === key ? "is-active" : "", title); b.type = "button";
      b.id = `ab-library-tab-${key}`; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(this.tab === key));
      b.setAttribute("aria-controls", "ab-library-tab-panel"); b.tabIndex = this.tab === key ? 0 : -1;
      const activate = () => { this.tab = key; this.render(); this.root?.querySelector<HTMLButtonElement>(`#ab-library-tab-${key}`)?.focus(); };
      b.onclick = activate;
      b.onkeydown = event => {
        const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
        if (next >= 0) { event.preventDefault(); tabButtons[next].click(); }
      };
      tabButtons.push(b);
    });
    const content = el(root, "div", "ab-paper-content"); content.id = "ab-library-tab-panel";
    content.setAttribute("role", "tabpanel"); content.setAttribute("aria-labelledby", `ab-library-tab-${this.tab}`);
    if (this.tab === "metadata") this.renderMetadata(content, paper);
    else if (this.tab === "contributions") this.renderContributions(content, paper);
    else this.renderKnowledge(content, paper);
    if (this.economicsPanel) this.economicsPanel.mount(el(root, "div"));
  }
  private renderMetadata(root: HTMLElement, paper: PaperDetail): void {
    const list = el(root, "dl", "ab-paper-metadata");
    const row = (name: string) => { el(list, "dt", "", name); return el(list, "dd"); };
    const m = paper.metadata;
    link(row("arXiv"), m.arxiv_id || "待补充", m.arxiv_id ? `https://arxiv.org/abs/${encodeURIComponent(m.arxiv_id)}` : null);
    link(row("DOI"), m.doi || "待补充", m.doi ? `https://doi.org/${encodeURIComponent(m.doi)}` : null);
    const authors = row("作者与机构");
    if (!m.authors.length) authors.textContent = "待补充";
    for (const author of m.authors) el(authors, "p", "", `${author.name} · ${author.affiliations.join("、") || "机构待补充"}`);
    row("发表状态").textContent = this.publication(paper);
    row("发表日期").textContent = date(m.publication.date);
    const versions = row("版本时间线");
    if (!m.versions.length) versions.textContent = "版本信息待补充";
    for (const version of m.versions) link(el(versions, "p"), `${version.version} · ${date(version.date)}`, version.url);
    row("本地文档").textContent = paper.source_path || "尚未关联本地文件";
    const sources = row("信息来源");
    if (!m.sources.length) sources.textContent = "暂无可核实的元数据来源";
    for (const source of m.sources) link(el(sources, "p"), `${source.label}${source.retrieved_at ? ` · ${date(source.retrieved_at)}` : ""}`, source.url);
  }
  private renderKnowledge(root: HTMLElement, paper: PaperDetail): void {
    if (paper.legacy_relations) el(root, "p", "ab-library-status", "栏目尚未归类 · 已确认关系保留在下方");
    const evidenceCount = paper.sections.reduce((total, s) => total + s.items.reduce((n, i) => n + i.evidence.length, 0), 0);
    const actions = el(root, "div", "ab-paper-evidence-actions");
    button(actions, "quote", "查看原文依据", () => this.revealEvidence(paper)).disabled = !evidenceCount;
    el(actions, "span", "ab-knowledge-meta", evidenceCount ? `已关联 ${evidenceCount} 处原文` : "尚无关联原文");
    for (const [key, title] of Object.entries(PAPER_SECTIONS)) {
      const section = paper.sections.find(s => s.key === key);
      const node = el(root, "details", `ab-paper-section${this.focusSection === key ? " is-focused" : ""}`);
      node.dataset.section = key; node.open = this.expanded.has(key) || this.focusSection === key;
      node.ontoggle = () => { if (node.open) this.expanded.add(key); else this.expanded.delete(key); };
      const summary = el(node, "summary"); el(summary, "span", "", title);
      el(summary, "span", "ab-paper-section-status", section ? `${section.status === "candidate" ? "知识待入库确认" : statuses[section.status]} · 已载入 ${section.items.length} 项` : "待整理");
      if (!section?.items.length) el(node, "p", "ab-library-empty", section?.status === "not_reported" ? "当前原文未明确报告此项" : "暂无已提炼的知识");
      for (const item of section?.items ?? []) {
        const entry = el(node, "div", `ab-knowledge-entry is-${item.status}`);
        entry.dataset.itemId = item.item_id;
        const approvedAnswer = item.status === "confirmed" && !!item.review?.scope.answer_approval;
        const excerpt = !approvedAnswer && isSourceExcerpt(item.text, item.evidence.map(source => source.text));
        el(entry, "div", "ab-knowledge-kind", approvedAnswer ? "用户认可的回答" : knowledgeLabel(excerpt, item.status));
        const relation = !excerpt && item.review && renderKnowledgeRelation(entry, item.review.scope, item.status);
        if (excerpt) el(entry, "p", "ab-source-preview", sourcePreview(item.text));
        else if (!item.review || !importedRelationStatement(item.text, item.review.scope)) renderKnowledgeText(entry, item.text);
        if (!excerpt && !relation) el(entry, "p", "ab-knowledge-meta", "文字结论 · 尚无结构化实体关系");
        const state = item.status === "withdrawn" ? "已撤回" : item.status === "candidate" ? (excerpt ? "尚未提炼结论" : "结论待核对") : statuses[item.status];
        const kind = item.kind ? { paper_statement: "论文陈述", personal_note: "个人笔记", inference: "推断" }[item.kind] : "";
        el(entry, "div", "ab-knowledge-meta", `${state}${kind ? ` · ${kind}` : ""}${item.confidence !== null ? ` · 置信度 ${Math.round(item.confidence * 100)}%` : ""}`);
        if (item.review) el(entry, "div", "ab-knowledge-meta", item.review.origin === "human" ? "人工审核" : item.review.origin === "automatic" ? "自动审核" : "尚未审核");
        const itemActions = el(entry, "div", "ab-knowledge-actions");
        if (item.review && this.client.reviews) {
          button(itemActions, "clipboard-check", approvedAnswer && item.status === "confirmed" ? "查看已入库知识" : excerpt ? "写下我的理解" : "核对结论", () => {
            if (this.reviewPanel || this.loading || this.callbacks.canReview?.() === false) return;
            this.reviewPanel = new PaperReviewPanel(this.client.reviews!, structuredClone(item.review!), this.callbacks.reviewer?.() || "user", {
              back: () => {
                this.searchPanel?.invalidate();
                this.reviewPanel?.dispose(); this.reviewPanel = null;
                this.callbacks.reviewSession?.(false);
                if (!this.disposed) void this.openPaper(paper.paper_id);
              }
            }, excerpt);
            this.callbacks.reviewSession?.(true); this.render();
          }).classList.add("ab-review-primary");
        }
        const pendingSource = item.evidence.find(source => source.location_status === "missing_location" && source.source_path && source.source_paper_id);
        if (pendingSource && this.callbacks.bindEvidence) {
          button(itemActions, "link", "关联本地原文", () => void this.bindEvidence(paper, pendingSource));
        }
        if (!item.evidence.length) { el(entry, "p", "ab-knowledge-meta", "尚无关联原文"); continue; }
        const evidence = el(entry, "details", "ab-knowledge-evidence"); el(evidence, "summary", "", `${excerpt ? "查看完整原文" : "查看原文依据"}（${item.evidence.length} 处）`);
        evidence.id = `ab-evidence-${item.item_id}`;
        evidence.open = this.expandedEvidence.has(item.item_id);
        evidence.ontoggle = () => {
          if (!evidence.isConnected) return;
          if (evidence.open) this.expandedEvidence.add(item.item_id); else this.expandedEvidence.delete(item.item_id);
          entry.classList.toggle("is-evidence-open", evidence.open);
        };
        entry.classList.toggle("is-evidence-open", evidence.open);
        for (const source of item.evidence) {
          el(evidence, "blockquote", "", source.text);
          const location = [source.location_label, source.revision].filter(Boolean).join(" · ");
          const b = button(evidence, "locate-fixed", location ? `跳转原文 · ${location}` : "跳转原文", () => void this.openEvidence(paper, source));
          b.disabled = !source.source_path || !source.locator.kind;
          if (b.disabled) {
            const reason = source.location_status === "source_changed" ? "原文已变更，待复核"
              : source.location_status === "ambiguous" ? "重复原文，位置不唯一" : "尚未关联本地原文位置";
            b.title = reason; el(evidence, "span", "ab-knowledge-meta", reason);
          }
        }
      }
    }
    if (paper.items_page?.next_cursor) {
      el(root, "p", "ab-library-status", `已载入 ${paper.items_page.loaded} / ${paper.items_page.total} 项知识`);
      button(root, "chevron-down", "更多知识", () => void this.moreItems()).disabled = this.loading;
    }
    if (paper.legacy_relations?.length) {
      const existing = el(root, "section", "ab-legacy-relations"); el(existing, "h4", "", "已确认关系");
      for (const r of paper.legacy_relations) {
        const entry = el(existing, "details", "ab-paper-section");
        el(entry, "summary", "", `${r.subject_name} · ${labelPolarity(r.polarity)} · ${labelRelation(r.relation_type)} · ${r.object_name}`);
        if (r.evidence_text) el(entry, "blockquote", "", r.evidence_text);
        if (r.source_question) el(entry, "p", "ab-knowledge-meta", `关联问题：${r.source_question}`);
      }
    }
  }
  private revealEvidence(paper: PaperDetail): void {
    const entries = paper.sections.flatMap(section => section.items.filter(item => item.evidence.length).map(item => ({ section, item })));
    const target = entries.find(({ item }) => item.status !== "withdrawn" && item.status !== "stale") ?? entries[0];
    if (!target) return;
    this.expanded.add(target.section.key); this.expandedEvidence.add(target.item.item_id);
    this.render();
    const entry = Array.from(this.root?.querySelectorAll<HTMLElement>("[data-item-id]") ?? []).find(node => node.dataset.itemId === target.item.item_id);
    entry?.scrollIntoView({ block: "nearest" });
    entry?.querySelector<HTMLElement>(".ab-knowledge-evidence > summary")?.focus({ preventScroll: true });
  }
  private renderContributions(root: HTMLElement, paper: PaperDetail): void {
    if (paper.legacy_relations) { el(root, "p", "ab-library-empty", "历史提问贡献尚未计算"); return; }
    if (!paper.contributions.contributions.length) el(root, "p", "ab-library-empty", "暂无提问贡献记录");
    for (const c of paper.contributions.contributions) this.renderContribution(root, c);
    if (paper.contributions.next_cursor) button(root, "chevron-down", "更多问题", () => void this.moreContributions()).disabled = this.loading;
  }
  private renderContribution(root: HTMLElement, c: QuestionContribution): void {
    const entry = el(root, "article", "ab-contribution");
    el(entry, "time", "ab-knowledge-meta", date(c.asked_at)); el(entry, "h4", "", c.question);
    if (c.status !== "completed") {
      el(entry, "p", "ab-library-status", c.status === "pending" ? "知识整理中" : c.status === "failed" ? "知识整理失败" : "处理状态待同步");
      if (c.status !== "unknown") return;
    }
    if (!c.changes.length && c.status === "completed") el(entry, "p", "ab-library-status", "本次没有新增或修正知识");
    for (const change of contributionGroups(c.changes)) {
      const line = el(entry, "div", "ab-contribution-change");
      el(line, "span", "ab-contribution-kind", changes[change.kind]);
      const key = change.section;
      const label = `${key ? PAPER_SECTIONS[key] : "相关知识"} · ${change.count} 项`;
      const b = button(line, "arrow-up-right", label, () => {
        this.focusSection = key; this.tab = "knowledge"; this.render();
        if (key) this.root?.querySelector<HTMLElement>(`[data-section="${key}"]`)?.scrollIntoView({ block: "nearest" });
      });
      b.classList.add("ab-contribution-target");
    }
  }
  private async openEvidence(paper: Pick<PaperCard, "paper_id" | "title">, source: PaperEvidence): Promise<void> {
    const epoch = this.epoch;
    try { await this.callbacks.evidence(paper, source); }
    catch (error) { if (this.active(epoch)) { this.error = this.message(error); this.retry = () => void this.openEvidence(paper, source); this.render(); } }
  }
  private async readBindingResult(paper: PaperCard, source: PaperEvidence): Promise<void> {
    const latest = await this.client.detail(paper.paper_id);
    const find = () => latest.sections.flatMap(section => section.items).flatMap(item => item.evidence)
      .find(e => e.evidence_id === source.evidence_id && e.source_paper_id === source.source_paper_id && e.text === source.text);
    // The clicked evidence may belong to a later knowledge page, not the initial 100 items.
    const cursors = new Set<string>();
    while (!this.disposed && !find() && latest.items_page?.next_cursor && this.client.items) {
      const cursor = latest.items_page.next_cursor;
      if (cursors.has(cursor)) throw new Error("知识分页未前进，暂时无法核对关联结果");
      cursors.add(cursor);
      const page = await this.client.items(paper.paper_id, cursor);
      for (const incoming of page.sections) {
        const section = latest.sections.find(s => s.key === incoming.key);
        if (!section) continue;
        const items = new Map(section.items.map(item => [item.item_id, item]));
        incoming.items.forEach(item => items.set(item.item_id, item)); section.items = [...items.values()];
      }
      latest.items_page = { loaded: latest.sections.reduce((n, s) => n + s.items.length, 0), total: page.total, next_cursor: page.next_cursor };
    }
    if (this.disposed) return;
    const located = find();
    this.paper = latest; this.selectedId = paper.paper_id;
    if (this.page) this.page.papers = this.page.papers.map(row => row.paper_id === paper.paper_id ? latest : row);
    const target = latest.sections.find(s => s.items.some(i => i.evidence.includes(located!)));
    const item = target?.items.find(i => i.evidence.includes(located!));
    if (target && item) { this.expanded.add(target.key); this.expandedEvidence.add(item.item_id); this.tab = "knowledge"; }
    const ready = located?.location_status === "locatable" && located.source_path && ["pdf", "markdown"].includes(located.locator.kind || "");
    const detail = ready ? `${located.source_path}${located.location_label ? ` · ${located.location_label}` : ""}`
      : !located ? "当前证据已变化或不在返回结果中，尚未确认它的原文位置。"
      : located.location_status === "ambiguous" ? "原文中有多处相同文字，无法确定唯一位置。"
      : located.location_status === "source_changed" ? "原文版本或内容已变化，当前证据不能定位到这份文件。"
      : "尚未找到这条证据的有效位置，请核对本地论文版本及原文文字。";
    this.bindingFeedback = { kind: ready ? "success" : "warning", title: ready ? "本地原文关联成功" : "当前证据尚未定位",
      detail, paper: latest, source, ...(ready ? { located } : {}) };
  }
  private async bindEvidence(paper: PaperCard, source: PaperEvidence, checkOnly = false): Promise<void> {
    if (this.disposed || this.binding || this.loading || this.reviewPanel) return;
    if (this.callbacks.canReview?.() === false) { this.callbacks.notify?.("当前任务尚未完成，请稍后再关联原文"); return; }
    if (!checkOnly && !this.callbacks.bindEvidence) return;
    this.binding = true; this.error = ""; this.retry = null; this.bindingFeedback = null;
    this.bindingPhase = checkOnly ? "正在重新核对证据位置" : "正在读取本地原文并保存关联";
    this.callbacks.reviewSession?.(true); this.render();
    let saved = false;
    try {
      if (!checkOnly) { await this.callbacks.bindEvidence!(paper, source); saved = true; }
      if (this.disposed) return;
      this.bindingPhase = "正在核对这条证据的原文位置"; this.render();
      await this.readBindingResult(paper, source);
    } catch (error) {
      if (!this.disposed) this.bindingFeedback = { kind: "error", title: saved ? "关联已保存，但结果核对失败" : checkOnly ? "关联结果核对失败" : "原文关联未确认",
        detail: this.message(error), paper, source };
    } finally {
      this.binding = false;
      if (!this.disposed) {
        this.searchPanel?.invalidate();
        this.callbacks.reviewSession?.(false); this.render();
        this.root?.querySelector<HTMLElement>(".ab-binding-result")?.scrollIntoView({ block: "nearest" });
        if (this.bindingFeedback) this.callbacks.notify?.(`${this.bindingFeedback.title}：${this.bindingFeedback.detail}`);
      }
    }
  }
}
