import { PAPER_SECTIONS, PaperSectionKey } from "./paper-library-contracts";

export interface ReviewItem {
  workId: string; itemId: string; paperId: string; revision: number;
  status: "candidate" | "confirmed" | "conflict" | "retracted" | "stale";
  origin: string; section: PaperSectionKey; statement: string;
  kind: "paper_statement" | "personal_note" | "inference";
  scope: Record<string, unknown>; evidence: Array<{ paragraph_id: string; quote: string }>;
}
export interface ReviewDraft { statement: string; section: PaperSectionKey; kind: ReviewItem["kind"]; scope: Record<string, unknown>; }
export interface ReviewEvent { id: string; kind: string; actor: string; createdAt: string; detail: Record<string, unknown>; }
export interface DossierReviews {
  item(workId: string, itemId: string): Promise<ReviewItem>;
  history(workId: string, itemId: string): Promise<ReviewEvent[]>;
  submit(item: ReviewItem, action: "confirm" | "withdraw" | "correct", actor: string, note: string, draft?: ReviewDraft): Promise<{ item: ReviewItem; replacementId: string | null }>;
}
type Transport = (path: string, body?: unknown) => Promise<{ status: number; json: unknown }>;
const invalid = () => new Error("知识审核数据不兼容，请刷新并核对本地服务");
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, any>;
}
function string(value: unknown): string { if (typeof value !== "string") throw invalid(); return value; }
export function parseReviewItem(value: unknown, workId: string, itemId?: string): ReviewItem {
  const r = object(value);
  if (r.work_id !== workId || (itemId && r.item_id !== itemId) || !r.item_id || !r.paper_id
    || !Number.isSafeInteger(r.revision) || r.revision < 1
    || !["candidate", "confirmed", "conflict", "retracted", "stale"].includes(r.effective_status)
    || !Object.prototype.hasOwnProperty.call(PAPER_SECTIONS, r.section)
    || !["paper_statement", "personal_note", "inference"].includes(r.kind)
    || !Array.isArray(r.evidence)) throw invalid();
  return { workId, itemId: string(r.item_id), paperId: string(r.paper_id), revision: r.revision,
    status: r.effective_status, origin: string(r.review_origin ?? ""), section: r.section,
    statement: string(r.statement), kind: r.kind, scope: structuredClone(object(r.scope)),
    evidence: r.evidence.map((value: unknown) => {
      const e = object(value);
      if (e.paper_id !== undefined && e.paper_id !== r.paper_id) throw invalid();
      return { paragraph_id: string(e.paragraph_id), quote: string(e.quote) };
    }) };
}
export class ReviewRequestError extends Error {
  constructor(message: string, readonly mustReload = true) { super(message); }
}
export class DossierReviewClient implements DossierReviews {
  constructor(private transport: Transport) {}
  private base(work: string): string { return `/api/v1/dossiers/${encodeURIComponent(work)}`; }
  private async get(path: string): Promise<Record<string, any>> {
    const result = await this.transport(path);
    if (result.status !== 200) throw new Error(`知识审核读取失败 (${result.status})`);
    return object(result.json);
  }
  async item(workId: string, itemId: string): Promise<ReviewItem> {
    const direct = await this.transport(`${this.base(workId)}/items/${encodeURIComponent(itemId)}`);
    if (direct.status === 200) return parseReviewItem(direct.json, workId, itemId);
    if (![404, 501].includes(direct.status)) throw new Error(`知识审核读取失败 (${direct.status})`);
    let offset = 0;
    while (true) {
      const page = await this.get(`${this.base(workId)}/items?limit=100&offset=${offset}`);
      if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 || page.offset !== offset
        || !page.items.length && offset < page.total) throw invalid();
      const raw = page.items.find((r: any) => r.item_id === itemId);
      if (raw) return parseReviewItem(raw, workId, itemId);
      offset += page.items.length;
      if (offset >= page.total) throw new Error("知识条目已不存在，请返回论文卡片刷新");
    }
  }
  async history(workId: string, itemId: string): Promise<ReviewEvent[]> {
    const response = await this.get(`${this.base(workId)}/items/${encodeURIComponent(itemId)}/history`);
    if (!Array.isArray(response.events)) throw invalid();
    return response.events.map((value: unknown) => {
      const e = object(value);
      if (e.work_id !== workId || e.item_id !== itemId) throw invalid();
      if (!Number.isSafeInteger(e.event_id) || e.event_id < 1) throw invalid();
      return { id: String(e.event_id), kind: string(e.kind), actor: string(e.actor), createdAt: string(e.created_at), detail: object(e.detail) };
    });
  }
  async submit(item: ReviewItem, action: "confirm" | "withdraw" | "correct", actor: string, note: string, draft?: ReviewDraft) {
    if (!actor.trim() || actor.length > 200 || note.length > 4000) throw new ReviewRequestError("审核人或备注不符合要求", false);
    if (item.status === "retracted" || item.status === "stale" && action !== "withdraw") throw new ReviewRequestError("此条目不可确认或修正，请核对原文版本", false);
    const body: Record<string, unknown> = { request_key: crypto.randomUUID(), revision: item.revision, status: action === "confirm" ? "confirmed" : "retracted", origin: "human", actor: actor.trim(), note };
    if (action === "correct") {
      if (!draft || !draft.statement.trim() || draft.statement.trim().length > 8000
        || !Object.prototype.hasOwnProperty.call(PAPER_SECTIONS, draft.section) || !["paper_statement", "personal_note", "inference"].includes(draft.kind)
        || !draft.scope || Array.isArray(draft.scope) || typeof draft.scope !== "object"
        || JSON.stringify(draft.scope).length > 4000) throw new ReviewRequestError("请填写修正内容并检查适用条件", false);
      if (draft.statement.trim() === item.statement && draft.section === item.section && draft.kind === item.kind
        && JSON.stringify(draft.scope) === JSON.stringify(item.scope)) throw new ReviewRequestError("修正内容没有变化", false);
      body.replacement = { ...draft, statement: draft.statement.trim(), evidence: item.evidence };
    }
    let response;
    try { response = await this.transport(`${this.base(item.workId)}/items/${encodeURIComponent(item.itemId)}/review`, body); }
    catch { throw new ReviewRequestError("连接中断，提交结果待核对。请重新读取状态，勿重复提交"); }
    if (response.status === 409) {
      const messages: Record<string, string> = { revision_conflict: "条目已被更新", source_changed: "原文版本已变化",
        knowledge_scope_conflict: "同一适用条件存在冲突知识", identity_conflict: "论文身份不一致", idempotency_conflict: "提交标识已被其他操作使用" };
      const code = response.json && typeof response.json === "object" ? (response.json as { code?: string }).code : undefined;
      throw new ReviewRequestError(`${messages[code || ""] || "条目版本、原文或同范围知识已变更"}。请重新读取后核对，未自动覆盖`);
    }
    if (response.status !== 200) throw new ReviewRequestError(`审核提交未成功 (${response.status})，请重新读取状态后核对`);
    try {
      const result = object(response.json), updated = parseReviewItem(result.item, item.workId, item.itemId);
      if (updated.paperId !== item.paperId || updated.revision <= item.revision
        || (action === "confirm" ? updated.status !== "confirmed" : updated.status !== "retracted")) throw invalid();
      const replacementId = result.replacement_id === null ? null : string(result.replacement_id);
      if ((action === "correct") !== !!replacementId || replacementId === item.itemId) throw invalid();
      return { item: updated, replacementId };
    } catch { throw new ReviewRequestError("已收到提交响应，但结果格式异常。请重新读取状态核对，勿重复提交"); }
  }
}
