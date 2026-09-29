import { setIcon } from "obsidian";
import { DossierReviews, ReviewEvent, ReviewItem, ReviewRequestError } from "./dossier-review-client";
import { PAPER_SECTIONS } from "./paper-library-contracts";
import { isSourceExcerpt, knowledgeLabel, renderKnowledgeText, scopeRows } from "./paper-knowledge-presentation";
import { correctedScope, editableKnowledgeStatement, importedRelationStatement, renderKnowledgeRelation } from "./knowledge-relation";

const statusNames = { candidate: "待核对", confirmed: "已确认", conflict: "存在冲突", retracted: "已撤回", stale: "原文已变更" };
const originName = (origin: string) => ({ human: "人工审核", automatic: "自动审核" }[origin] || "尚未审核");
function node<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "", cls = "") {
  const el = document.createElement(tag); el.textContent = text; el.className = cls; parent.append(el); return el;
}
function command(parent: HTMLElement, label: string, icon: string, action: () => void) {
  const b = node(parent, "button", "", "ab-library-button"); b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
  setIcon(node(b, "span", "", "fkms-button-icon"), icon); node(b, "span", label); b.onclick = action; return b;
}
export class PaperReviewPanel {
  private root: HTMLElement | null = null;
  private disposed = false;
  private busy = false;
  private needsReload = false;
  private error = "";
  private notice = "";
  private events: ReviewEvent[] | null = null;
  private historyError = "";
  private historyLoading = false;
  private historyEpoch = 0;
  private mode: "inspect" | "confirm" | "withdraw" | "correct" = "inspect";
  private statement = "";
  private scope: Record<string, unknown> = {};
  private section: ReviewItem["section"];
  private kind: ReviewItem["kind"];
  private note = "";
  private pendingReplacement: string | null = null;
  private draftBackup: { statement: string; scope: Record<string, unknown>; section: ReviewItem["section"]; kind: ReviewItem["kind"]; note: string } | null = null;
  constructor(private client: DossierReviews, private item: ReviewItem, private actor: string,
    private callbacks: { back(): void }, startWriting = false) {
    this.section = item.section; this.kind = item.kind;
    if (startWriting && ["candidate", "conflict", "confirmed"].includes(item.status)) this.edit("correct");
  }
  mount(root: HTMLElement) { this.root = root; this.render(); }
  dispose() { this.disposed = true; this.historyEpoch++; this.root = null; }
  private edit(mode: typeof this.mode) {
    if (this.busy || this.needsReload || this.disposed) return;
    this.mode = mode; this.statement = this.item.statement; this.scope = structuredClone(this.item.scope);
    if (mode === "correct" && this.isExcerpt()) this.statement = "";
    else if (mode === "correct") this.statement = editableKnowledgeStatement(this.statement, this.scope);
    this.section = this.item.section; this.kind = this.item.kind; this.note = ""; this.error = ""; this.render();
  }
  private isExcerpt() { return !this.item.scope.answer_approval && isSourceExcerpt(this.item.statement, this.item.evidence.map(anchor => anchor.quote)); }
  private async reload() {
    if (this.busy || this.disposed) return;
    if (this.mode === "correct") this.draftBackup = { statement: this.statement, scope: this.scope, section: this.section, kind: this.kind, note: this.note };
    this.busy = true; this.error = ""; this.render();
    try {
      const latest = await this.client.item(this.item.workId, this.pendingReplacement || this.item.itemId);
      if (this.disposed) return;
      this.item = latest; this.pendingReplacement = null; this.needsReload = false;
      this.notice = "已读取最新状态，请核对原文与修改历史后再操作";
      this.mode = "inspect"; this.events = null; this.historyEpoch++; this.historyLoading = false;
    } catch (error) { if (!this.disposed) this.error = this.message(error); }
    finally { this.busy = false; this.render(); }
  }
  private async history() {
    if (this.historyLoading || this.disposed) return;
    const epoch = ++this.historyEpoch;
    this.historyLoading = true; this.historyError = ""; this.render();
    try {
      const events = await this.client.history(this.item.workId, this.item.itemId);
      if (!this.disposed && epoch === this.historyEpoch) this.events = events;
    } catch (error) { if (!this.disposed && epoch === this.historyEpoch) this.historyError = this.message(error); }
    finally { if (epoch === this.historyEpoch) { this.historyLoading = false; this.render(); } }
  }
  private async submit() {
    if (this.busy || this.needsReload || this.mode === "inspect" || this.disposed) return;
    const mode = this.mode;
    if (mode === "correct") {
      if (!this.statement.trim()) { this.error = "请填写你的理解后再保存"; this.render(); return; }
    }
    this.busy = true; this.error = ""; this.notice = ""; this.render();
    try {
      const result = await this.client.submit(this.item, mode, this.actor, this.note,
        mode === "correct" ? { statement: this.statement, section: this.section, kind: this.kind, scope: correctedScope(this.scope, this.statement.trim() !== this.item.statement.trim()) } : undefined);
      if (this.disposed) return;
      this.item = result.item; this.pendingReplacement = result.replacementId;
      this.mode = "inspect"; this.events = null; this.historyEpoch++; this.historyLoading = false;
      this.notice = mode === "confirm" ? "已确认入库" : mode === "withdraw" ? "已撤回，原条目及历史记录保留" : "已保存为待确认知识，尚未纳入已确认知识";
      this.draftBackup = null;
      if (result.replacementId) {
        this.needsReload = true;
        this.item = await this.client.item(result.item.workId, result.replacementId);
        this.pendingReplacement = null; this.needsReload = false;
      }
    } catch (error) {
      if (!this.disposed) { this.error = this.message(error); this.needsReload = !(error instanceof ReviewRequestError) || error.mustReload; }
    } finally { this.busy = false; this.render(); }
  }
  private message(error: unknown) { return error instanceof Error ? error.message : "知识审核操作失败"; }
  private async agree() {
    if (this.busy || this.needsReload || this.disposed || this.isExcerpt()
      || !["candidate", "conflict", "confirmed"].includes(this.item.status)
      || this.item.status === "confirmed" && this.item.origin === "human") return;
    this.mode = "confirm"; this.note = "";
    await this.submit();
  }
  private render() {
    if (!this.root || this.disposed) return;
    this.root.replaceChildren();
    const root = node(this.root, "section", "", "ab-paper-review");
    const nav = node(root, "div", "", "fkms-back-navigation");
    command(nav, this.mode === "inspect" ? "返回论文卡片" : "返回知识条目", "arrow-left", () => {
      if (this.busy) return;
      if (this.mode !== "inspect") { this.mode = "inspect"; this.render(); return; }
      this.callbacks.back();
    }).disabled = this.busy;
    const excerpt = this.isExcerpt();
    node(root, "h3", this.mode === "correct" ? (excerpt ? "写下我的理解" : "修改结论") : this.mode === "withdraw" ? "撤回条目" : this.mode === "confirm" ? "入库前核对" : (excerpt ? "待整理的原文" : "核对结论"));
    const status = this.item.status === "candidate" ? (excerpt ? "尚未提炼结论" : "待确认入库") : statusNames[this.item.status];
    const statusLine = node(root, "p", `${PAPER_SECTIONS[this.item.section]} · ${status} · ${originName(this.item.origin)}`, "ab-knowledge-meta");
    if (this.mode !== "correct" && !excerpt) {
      node(root, "h4", this.item.status === "confirmed" && this.item.scope.answer_approval ? "用户认可的回答" : knowledgeLabel(false, this.item.status));
      const relation = renderKnowledgeRelation(root, this.item.scope, this.item.status);
      if (!importedRelationStatement(this.item.statement, this.item.scope)) renderKnowledgeText(root, this.item.statement);
      if (!relation) node(root, "p", "文字结论 · 尚无结构化实体关系", "ab-knowledge-meta");
    }
    if (scopeRows(this.item.scope).length) {
      const conditions = node(root, "details"); node(conditions, "summary", "当前适用条件");
      const values = node(conditions, "dl", "", "ab-insights-scope");
      for (const row of scopeRows(this.item.scope)) { node(values, "dt", row.label); node(values, "dd", row.value); }
    }
    const uniqueQuotes = [...new Set(this.item.evidence.map(anchor => anchor.quote))];
    const quotes = excerpt ? [this.item.statement, ...uniqueQuotes.filter(quote => !isSourceExcerpt(this.item.statement, [quote]))] : uniqueQuotes;
    if (quotes.length) {
      const evidence = node(root, "details", "", "ab-review-evidence");
      evidence.open = this.mode === "correct" || this.mode === "confirm";
      node(evidence, "summary", `${excerpt ? "查看原文" : "查看原文依据"}（${quotes.length} 处）`);
      for (const quote of quotes) node(evidence, "blockquote", quote, "ab-knowledge-text");
    }
    if (!this.item.evidence.length) node(root, "p", "尚无关联原文", "ab-knowledge-meta");
    if (this.notice) node(root, "p", this.notice, "ab-library-status").setAttribute("role", "status");
    if (this.error) node(root, "p", this.error, "ab-library-error").setAttribute("role", "alert");
    if (this.draftBackup) {
      const saved = node(root, "details"); node(saved, "summary", "保留的修正草稿");
      node(saved, "p", this.draftBackup.statement);
      if (!["stale", "retracted"].includes(this.item.status)) command(saved, "载入草稿重新核对", "pencil", () => {
        if (this.busy || this.needsReload) return;
        const draft = this.draftBackup!; this.edit("correct");
        this.statement = draft.statement; this.scope = draft.scope; this.section = draft.section; this.kind = draft.kind; this.note = draft.note; this.render();
      }).disabled = this.busy || this.needsReload;
    }
    if (this.needsReload) command(root, "重新读取状态", "refresh-cw", () => void this.reload()).disabled = this.busy;
    if (this.busy) {
      const progress = node(root, "div", "", "ab-library-status"); progress.setAttribute("role", "status");
      setIcon(node(progress, "span", "", "fkms-progress-stage-icon is-spinning"), "loader-circle");
      node(progress, "span", "正在提交或核对知识库状态");
    }
    const fields = node(root, "fieldset", "", "ab-review-fields"); fields.disabled = this.busy || this.needsReload;
    if (this.mode === "inspect") {
      const actions = node(fields, "div", "", "ab-review-actions");
      if (["candidate", "conflict", "confirmed"].includes(this.item.status)) {
        const confirm = () => {
          const b = command(actions, this.item.status === "confirmed" && this.item.origin === "human" ? "已同意入库" : "同意并入库", "check", () => void this.agree());
          b.disabled = this.item.status === "confirmed" && this.item.origin === "human";
          if (!excerpt) b.classList.add("ab-review-primary");
        };
        if (!excerpt) confirm();
        const correct = command(actions, excerpt ? "写下我的理解" : "我要修正", "pencil", () => this.edit("correct"));
        if (excerpt) correct.classList.add("ab-review-primary");
      }
      if (this.item.status !== "retracted") command(actions, "撤回", "undo-2", () => this.edit("withdraw"));
      statusLine.after(fields);
    } else {
      if (this.mode === "correct") {
        const label = node(fields, "label", "我的理解");
        const input = node(label, "textarea"); input.value = this.statement; input.rows = 5; input.maxLength = 8000;
        input.placeholder = "例如：本文用数据集 A 训练模型，用数据集 B 评测泛化能力。"; input.oninput = () => { this.statement = input.value; };
        const advanced = node(fields, "details"); node(advanced, "summary", "知识分类（可选）");
        const sectionLabel = node(advanced, "label", "知识栏目"), section = node(sectionLabel, "select");
        for (const [value, text] of Object.entries(PAPER_SECTIONS)) { const option = node(section, "option", text); option.value = value; }
        section.value = this.section; section.onchange = () => { this.section = section.value as ReviewItem["section"]; };
        const kindLabel = node(advanced, "label", "知识类型"), kind = node(kindLabel, "select");
        for (const [value, text] of Object.entries({ paper_statement: "论文陈述", personal_note: "个人笔记", inference: "推断" })) { const option = node(kind, "option", text); option.value = value; }
        kind.value = this.kind; kind.onchange = () => { this.kind = kind.value as ReviewItem["kind"]; };
      }
      const notes = node(fields, "details"); node(notes, "summary", "审核备注（可选）");
      const label = node(notes, "label", "备注"), note = node(label, "textarea");
      note.value = this.note; note.rows = 2; note.maxLength = 4000; note.oninput = () => { this.note = note.value; };
      const actions = node(fields, "div", "", "ab-review-actions");
      command(actions, this.mode === "confirm" ? "同意并入库" : this.mode === "withdraw" ? "确认撤回" : "保存修正", "save", () => void this.submit()).classList.add("ab-review-primary");
      command(actions, "取消", "x", () => this.edit("inspect"));
    }
    const history = node(root, "section", "", "ab-review-history");
    command(history, "修改历史", "history", () => void this.history()).disabled = this.busy || this.historyLoading;
    if (this.historyLoading) node(history, "p", "正在读取修改历史");
    if (this.historyError) node(history, "p", this.historyError, "ab-library-error");
    if (this.events?.length === 0) node(history, "p", "暂无修改记录");
    for (const event of this.events ?? []) {
      const row = node(history, "article", "", "ab-review-event");
      const names: Record<string, string> = { added: "新增", corrected: "修正", confirmed: "确认", retracted: "撤回", candidate: "设为候选", conflict: "冲突", evidence_added: "补充证据", first_revealed: "首次披露", no_change: "无变更" };
      const actor = event.actor === this.actor ? "我" : event.detail.origin === "human" ? "用户" : "系统";
      node(row, "p", `${names[event.kind] || "记录更新"} · ${actor} · ${event.createdAt}`);
      if (typeof event.detail.from === "string" && typeof event.detail.to === "string") {
        const label = (value: string) => (statusNames as Record<string, string>)[value] || "待核对";
        node(row, "p", `${label(event.detail.from)} → ${label(event.detail.to)} · 第 ${event.detail.revision ?? "?"} 版 · ${originName(String(event.detail.origin || ""))}`);
      }
      if (typeof event.detail.note === "string" && event.detail.note) node(row, "p", event.detail.note);
      if (typeof event.detail.replacement_id === "string") {
        command(row, "查看修正条目", "arrow-up-right", () => {
          if (this.busy) return;
          this.pendingReplacement = event.detail.replacement_id as string;
          this.needsReload = true; void this.reload();
        }).disabled = this.busy;
      }
    }
  }
}
