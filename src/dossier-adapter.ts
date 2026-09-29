import {
  PAPER_SECTIONS, ContributionPage, PaperCard, PaperDetail, PaperEvidence, PaperItemPage,
  PaperKnowledgeItem, PaperMetadata, PaperPage, PaperSection, PaperSectionKey, QuestionContribution, SectionStatus
} from "./paper-library-contracts";
import { parseReviewItem } from "./dossier-review-client";

export type DossierTransport = (path: string) => Promise<{ status: number; json: unknown }>;
const invalid = () => new Error("论文档案接口与当前前端不兼容，请等待接口联调完成");
function obj(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, any>;
}
function text(value: unknown): string { if (typeof value !== "string") throw invalid(); return value; }
function list(value: unknown): any[] { if (!Array.isArray(value)) throw invalid(); return value; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid(); return Number(value); }
function sectionKey(value: unknown): PaperSectionKey {
  const key = text(value); if (!Object.prototype.hasOwnProperty.call(PAPER_SECTIONS, key)) throw invalid(); return key as PaperSectionKey;
}
function localPath(uri: string): string | null {
  if (!uri.startsWith("obsidian://")) return null;
  try { return decodeURIComponent(uri.slice(11)); } catch { return null; }
}
function nextCursor(raw: Record<string, any>, rows: any[]): string | null {
  const total = count(raw.total), offset = count(raw.offset), limit = count(raw.limit);
  if (!limit || rows.length > limit || (rows.length === 0 && offset < total)) throw invalid();
  return offset + rows.length < total ? String(offset + rows.length) : null;
}
const sectionStates: Record<string, SectionStatus> = {
  unexplored: "unexplored", candidate: "candidate", partially_confirmed: "partial", conflict: "conflict", stale: "stale"
};
function sections(work: Record<string, any>): PaperSection[] {
  const mapped = list(work.sections).map(raw => {
    const s = obj(raw), key = sectionKey(s.section), status = sectionStates[text(s.state)];
    if (!status) throw invalid();
    return { key, status, items: [] as PaperKnowledgeItem[] };
  });
  if (mapped.length !== Object.keys(PAPER_SECTIONS).length || new Set(mapped.map(s => s.key)).size !== mapped.length) throw invalid();
  return mapped;
}
function metadata(work: Record<string, any>): PaperMetadata {
  const m = obj(work.metadata), sources = list(work.sources).map(obj), first = sources[0];
  const aliases = list(work.aliases).map(text);
  const authorField = m.authors ? obj(m.authors) : null;
  const rawAuthors = authorField ? list(authorField.value) : list(first?.authors ?? []);
  const authors = rawAuthors.map(a => typeof a === "string" ? { name: a, affiliations: [] }
    : { name: text(obj(a).name), affiliations: list(a.affiliations ?? []).map(text) });
  const pub = obj(work.publication), states = { unverified: "unknown", preprint: "preprint", accepted: "accepted", published: "published" } as const;
  const status = states[text(pub.status) as keyof typeof states]; if (!status) throw invalid();
  const records = Object.entries(m).map(([label, field]) => {
    const f = obj(field); return { label: ({ title: "标题", authors: "作者", publication: "发表信息", official_versions: "版本记录" } as Record<string, string>)[label] || label,
      url: text(f.source_uri), retrieved_at: typeof f.retrieved_at === "string" ? f.retrieved_at : null };
  });
  if (first && !authorField) records.push({ label: "论文原始记录", url: text(first.source_uri), retrieved_at: null });
  return {
    arxiv_id: aliases.find(a => a.startsWith("arxiv:"))?.slice(6) ?? null,
    doi: aliases.find(a => a.startsWith("doi:"))?.slice(4) ?? null, authors,
    publication: { status, venue: typeof pub.venue === "string" ? pub.venue : null, date: typeof pub.date === "string" ? pub.date : null },
    versions: m.official_versions ? list(obj(m.official_versions).value).map(v => ({ version: text(obj(v).version), date: text(v.submitted_at), url: text(v.source_uri) })) : [],
    sources: records
  };
}
function card(raw: unknown): PaperCard {
  const w = obj(raw), counts = obj(w.counts), totalSections = count(w.total_sections), explored = count(w.explored_sections);
  if (totalSections !== Object.keys(PAPER_SECTIONS).length || explored > totalSections) throw invalid();
  const source = list(w.sources).find(s => typeof s.source_uri === "string" && s.source_uri.startsWith("obsidian://"));
  return { paper_id: text(w.work_id), title: text(w.title), source_path: source ? localPath(source.source_uri) : null,
    question_count_scope: w.question_count_scope === "dossier_linked" ? "dossier_linked" : undefined,
    metadata: metadata(w), counts: { questions: w.question_count_scope === "dossier_linked" ? count(w.question_count) : null, confirmed: count(counts.confirmed ?? 0), candidate: count(counts.candidate ?? 0), explored_sections: explored },
    updated_at: typeof w.updated_at === "string" ? w.updated_at : null };
}
export function mapEvidence(e: Record<string, any>, source: Record<string, any>, id: string, index: number): PaperEvidence {
  const result: PaperEvidence = { evidence_id: `${id}:${text(e.paragraph_id)}:${index}`, text: text(e.quote),
    source_paper_id: text(e.paper_id), source_path: localPath(source.source_uri), locator: {},
    location_label: text(e.section_title), revision: source.arxiv_version || null };
  if (e.location_status === undefined) { result.source_path = null; return result; }
  if (!["locatable", "missing_location", "source_changed", "ambiguous"].includes(e.location_status)) throw invalid();
  result.location_status = e.location_status;
  if (e.source_binding) {
    const binding = obj(e.source_binding);
    if (binding.source_path) result.source_path = text(binding.source_path);
  }
  const snapshot = obj(e.snapshot ?? {});
  result.snapshot = {};
  for (const key of ["file_sha256", "supplied_text_sha256"] as const) {
    if (snapshot[key] === undefined) continue;
    if (!/^[a-f\d]{64}$/i.test(text(snapshot[key]))) throw invalid();
    result.snapshot[key] = snapshot[key].toLowerCase();
  }
  if (e.location_status !== "locatable") return result;
  const locator = obj(e.locator);
  if (!["pdf", "markdown"].includes(locator.kind)) throw invalid();
  for (const key of ["page", "line_start", "line_end", "begin_index", "begin_offset", "end_index", "end_offset"]) {
    if (locator[key] !== undefined) count(locator[key]);
  }
  if (locator.kind === "pdf" && !(locator.page >= 1)) throw invalid();
  if (locator.page_end !== undefined && (!Number.isSafeInteger(locator.page_end) || locator.page_end < locator.page)) throw invalid();
  if (locator.kind === "markdown" && !(locator.line_start >= 1 && locator.line_end >= locator.line_start)) throw invalid();
  result.locator = { ...locator }; result.location_label = text(e.location_label);
  if (locator.kind === "pdf" && locator.page_end > locator.page) result.location_label = `第 ${locator.page}-${locator.page_end} 页（从起始页查看）`;
  return result;
}
function mapItems(raw: unknown, work: Record<string, any>): PaperItemPage {
  const data = obj(raw), rows = list(data.items), result = sections(work), seen = new Set<string>();
  for (const rawItem of rows) {
    const item = obj(rawItem), key = sectionKey(item.section), id = text(item.item_id);
    if (seen.has(id)) throw invalid(); seen.add(id);
    if (item.work_id !== work.work_id) throw invalid();
    const source = list(work.sources).find(s => s.paper_id === item.paper_id); if (!source) throw invalid();
    const state = text(item.effective_status);
    if (!["candidate", "confirmed", "conflict", "retracted", "stale"].includes(state)) throw invalid();
    const kind = text(item.kind);
    if (!["paper_statement", "personal_note", "inference"].includes(kind)) throw invalid();
    result.find(s => s.key === key)!.items.push({ item_id: id, text: text(item.statement),
      status: state === "retracted" ? "withdrawn" : state as PaperKnowledgeItem["status"],
      kind: kind as PaperKnowledgeItem["kind"], confidence: null, source_question_ids: [],
      review: item.revision === undefined ? undefined : parseReviewItem(item, work.work_id),
      evidence: list(item.evidence).map((rawEvidence, index) => {
        const e = obj(rawEvidence);
        if (e.paper_id !== item.paper_id) throw invalid();
        return mapEvidence(e, source, id, index);
      }) });
  }
  return { sections: result, total: count(data.total), next_cursor: nextCursor(data, rows) };
}

export class DossierReadAdapter {
  private works = new Map<string, Record<string, any>>();
  private itemIndex = new Map<string, Map<string, { key: PaperSectionKey; text: string }>>();
  constructor(private transport: DossierTransport) {}
  private async get(path: string): Promise<Record<string, any>> {
    const r = await this.transport(path);
    if (r.status !== 200) throw new Error(`论文档案服务返回 ${r.status}，请重试`);
    return obj(r.json);
  }
  listResponse(raw: unknown): PaperPage {
    const data = obj(raw), rows = list(data.works), papers = rows.map(card);
    if (new Set(papers.map(p => p.paper_id)).size !== papers.length) throw invalid();
    rows.forEach(w => this.works.set(w.work_id, w));
    return { papers, total: count(data.total), next_cursor: nextCursor(data, rows), mode: "native",
      sorting: ["updated_at", "title"].includes(data.sort) && ["asc", "desc"].includes(data.order) };
  }
  async detail(id: string): Promise<PaperDetail> {
    const path = `/api/v1/dossiers/${encodeURIComponent(id)}`;
    const work = await this.get(path);
    if (work.work_id !== id) throw invalid();
    this.works.set(id, work); this.itemIndex.delete(id);
    const page = await this.items(id, "0");
    const rawContributions = await this.get(`${path}/contributions?limit=20&offset=0`);
    const contributions = this.mapContributions(id, rawContributions);
    const summary = card(work); summary.counts.questions = count(rawContributions.total);
    return { ...summary, sections: page.sections, contributions,
      items_page: { loaded: page.sections.reduce((n, s) => n + s.items.length, 0), total: page.total, next_cursor: page.next_cursor } };
  }
  async items(id: string, cursor: string): Promise<PaperItemPage> {
    const work = this.works.get(id); if (!work) throw invalid();
    const page = mapItems(await this.get(`/api/v1/dossiers/${encodeURIComponent(id)}/items?limit=100&offset=${encodeURIComponent(cursor)}`), work);
    const index = this.itemIndex.get(id) || new Map();
    page.sections.forEach(s => s.items.forEach(i => index.set(i.item_id, { key: s.key, text: i.text })));
    this.itemIndex.set(id, index); return page;
  }
  async contributions(id: string, cursor: string): Promise<ContributionPage> {
    return this.mapContributions(id, await this.get(`/api/v1/dossiers/${encodeURIComponent(id)}/contributions?limit=20&offset=${encodeURIComponent(cursor)}`));
  }
  private mapContributions(id: string, raw: Record<string, any>): ContributionPage {
    const rows = list(raw.questions), index = this.itemIndex.get(id);
    const kinds: Record<string, QuestionContribution["changes"][number]["kind"]> = {
      added: "added", evidence_added: "supported", corrected: "corrected", retracted: "withdrawn",
      first_revealed: "revealed", no_change: "unchanged", confirmed: "confirmed", conflict: "conflict"
    };
    return { next_cursor: nextCursor(raw, rows), contributions: rows.map(value => {
      const q = obj(value);
      const job = q.job ? obj(q.job) : null;
      const states: Record<string, QuestionContribution["status"]> = {
        queued: "pending", running: "pending", completed: "completed", failed: "failed"
      };
      const directlyApproved = list(q.events).some(value => {
        const event = obj(value);
        return event.kind === "confirmed" && event.detail?.approval_scope === "displayed_answer_only";
      });
      const status = job ? states[text(job.state)] : directlyApproved ? "completed" : "unknown";
      if (!status) throw invalid();
      return { understanding_id: text(q.question_id), question: text(q.question), asked_at: text(q.created_at),
        source_understanding_id: typeof q.source_question_id === "string" ? q.source_question_id : undefined,
        job_id: job ? text(job.job_id) : null,
        status, changes: list(q.events).map(rawEvent => {
          const e = obj(rawEvent), item = index?.get(text(e.item_id)), kind = kinds[text(e.kind)];
          if (!kind) throw invalid();
          return { kind, item_id: e.item_id, section_key: item?.key ?? null, summary: item?.text ?? `知识条目 ${e.item_id}` };
        }) };
    }) };
  }
}
