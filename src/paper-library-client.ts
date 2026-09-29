import { requestUrl } from "obsidian";
import { DossierReadAdapter } from "./dossier-adapter";
import { DossierReviewClient } from "./dossier-review-client";
import { DossierInsightsClient } from "./dossier-insights";
import type { AnswerKnowledgeSource } from "./answer-knowledge-panel";
import { readPaperGraph } from "./paper-graph-client";
import { DraftSelection, PersonalKnowledgeSnapshot } from "./contracts";
import {
  ContributionPage, PAPER_SECTIONS, PaperCard, PaperDetail, PaperLibraryDataSource,
  PaperMetadata, PaperPage, QuestionContribution
} from "./paper-library-contracts";

type Response = { status: number; json: unknown };
type Transport = (path: string, body?: unknown) => Promise<Response>;
export function localLibraryUrl(base: string): string {
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("论文档案服务地址无效"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("论文档案服务必须使用 localhost、127.0.0.1 或 ::1 本机地址");
  }
  return url.href.replace(/\/+$/, "");
}
const schemaError = () => new Error("论文档案数据格式不兼容，请更新本地服务后重试");
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw schemaError();
  return value as Record<string, any>;
}
function string(value: unknown): asserts value is string { if (typeof value !== "string") throw schemaError(); }
function nullableString(value: unknown): void { if (value !== null) string(value); }
function array(value: unknown): asserts value is any[] { if (!Array.isArray(value)) throw schemaError(); }
function count(value: unknown): void { if (!Number.isSafeInteger(value) || Number(value) < 0) throw schemaError(); }
function oneOf(value: unknown, choices: readonly string[]): void { if (!choices.includes(String(value))) throw schemaError(); }
function metadata(value: unknown): void {
  const m = record(value);
  nullableString(m.arxiv_id); nullableString(m.doi); array(m.authors); array(m.versions); array(m.sources);
  for (const a of m.authors) { record(a); string(a.name); array(a.affiliations); a.affiliations.forEach(string); }
  const p = record(m.publication);
  oneOf(p.status, ["unknown", "preprint", "accepted", "published"]); nullableString(p.venue); nullableString(p.date);
  for (const v of m.versions) { record(v); string(v.version); nullableString(v.date); nullableString(v.url); }
  for (const s of m.sources) { record(s); string(s.label); nullableString(s.url); nullableString(s.retrieved_at); }
}
function card(value: unknown): asserts value is PaperCard {
  const p = record(value); string(p.paper_id); if (!p.paper_id) throw schemaError();
  string(p.title); nullableString(p.source_path); nullableString(p.updated_at); metadata(p.metadata);
  const c = record(p.counts); count(c.confirmed);
  for (const key of ["questions", "candidate", "explored_sections"]) if (c[key] !== null) count(c[key]);
  if (c.explored_sections > Object.keys(PAPER_SECTIONS).length) throw schemaError();
}
function contributionPage(value: unknown): asserts value is ContributionPage {
  const p = record(value); array(p.contributions); nullableString(p.next_cursor);
  const ids = new Set<string>();
  for (const raw of p.contributions) {
    const c = record(raw); string(c.understanding_id); string(c.question); string(c.asked_at);
    if (!c.understanding_id || ids.has(c.understanding_id)) throw schemaError();
    ids.add(c.understanding_id);
    oneOf(c.status, ["pending", "completed", "failed", "unknown"]); array(c.changes);
    for (const change of c.changes) {
      record(change); oneOf(change.kind, ["added", "supported", "corrected", "withdrawn", "revealed", "unchanged", "confirmed", "conflict"]);
      if (change.section_key !== null) oneOf(change.section_key, Object.keys(PAPER_SECTIONS)); string(change.item_id); string(change.summary);
    }
  }
}
function detail(value: unknown): asserts value is PaperDetail {
  card(value);
  const p = record(value); array(p.sections); contributionPage(p.contributions);
  const keys = new Set<string>();
  for (const section of p.sections) {
    record(section); oneOf(section.key, Object.keys(PAPER_SECTIONS));
    if (keys.has(section.key)) throw schemaError();
    keys.add(section.key);
    oneOf(section.status, ["unexplored", "candidate", "partial", "confirmed", "conflict", "not_reported", "stale"]);
    array(section.items);
    for (const item of section.items) {
      record(item); string(item.item_id); string(item.text);
      oneOf(item.status, ["candidate", "confirmed", "conflict", "withdrawn", "stale"]);
      if (item.confidence !== null && (typeof item.confidence !== "number" || !Number.isFinite(item.confidence)
          || item.confidence < 0 || item.confidence > 1)) throw schemaError();
      array(item.source_question_ids); item.source_question_ids.forEach(string); array(item.evidence);
      for (const e of item.evidence) {
        record(e); string(e.evidence_id); string(e.text); nullableString(e.source_path);
        string(e.location_label); nullableString(e.revision); record(e.locator);
        if (e.locator.kind !== undefined) oneOf(e.locator.kind, ["pdf", "markdown"]);
        for (const key of ["page", "line_start", "line_end", "begin_index", "begin_offset", "end_index", "end_offset"]) {
          if (e.locator[key] !== undefined) count(e.locator[key]);
        }
      }
    }
  }
  // A partial payload must not silently turn omitted topics into unexplored ones.
  if (keys.size !== Object.keys(PAPER_SECTIONS).length) throw schemaError();
}
export function emptyPaperMetadata(): PaperMetadata {
  return { arxiv_id: null, doi: null, authors: [], publication: { status: "unknown", venue: null, date: null }, versions: [], sources: [] };
}

export function legacyPaperDetails(snapshot: PersonalKnowledgeSnapshot): PaperDetail[] {
  const papers = new Map<string, PaperDetail>();
  for (const relation of snapshot.relations) {
    const stableId = (relation as typeof relation & { paper_id?: string }).paper_id;
    const id = stableId ? `legacy:paper:${stableId}` : relation.source_uri
      ? `legacy:source:${relation.source_uri}` : `legacy:unresolved:${relation.assertion_id}`;
    let p = papers.get(id);
    if (!p) {
      let path: string | null = null;
      if (relation.source_uri.startsWith("obsidian://")) {
        try { path = decodeURIComponent(relation.source_uri.slice("obsidian://".length)); } catch { /* Keep unmappable sources read-only. */ }
      }
      p = { paper_id: id, title: relation.paper_title || "未命名论文", source_path: path,
        metadata: emptyPaperMetadata(), counts: { questions: null, confirmed: 0, candidate: null, explored_sections: null },
        updated_at: relation.updated_at || null, sections: [], contributions: { contributions: [], next_cursor: null }, legacy_relations: [] };
      papers.set(id, p);
    }
    if (!p.legacy_relations!.some(r => r.assertion_id === relation.assertion_id)) {
      p.legacy_relations!.push(relation); p.counts.confirmed++;
    }
    if ((relation.updated_at || "") > (p.updated_at || "")) p.updated_at = relation.updated_at;
  }
  return [...papers.values()];
}

export class PaperLibraryClient implements PaperLibraryDataSource {
  private legacy = new Map<string, PaperDetail>();
  private readonly transport: Transport;
  private readonly dossiers: DossierReadAdapter;
  private readonly reviewClient: DossierReviewClient;
  private readonly insights: DossierInsightsClient;
  get reviews(): DossierReviewClient | undefined { return this.mode === "dossiers" ? this.reviewClient : undefined; }
  answerKnowledgeSource(): AnswerKnowledgeSource {
    return { contributions: (work, cursor) => this.dossiers.contributions(work, cursor), reviews: this.reviewClient };
  }
  private mode: "dossiers" | "library" | "legacy" = "library";
  constructor(baseUrl: string, transport?: Transport) {
    this.transport = transport ?? (async (path, body) => requestUrl({ url: localLibraryUrl(baseUrl) + path,
      method: body === undefined ? "GET" : "POST", throw: false,
      ...(body === undefined ? {} : { contentType: "application/json", body: JSON.stringify(body) }) }));
    this.dossiers = new DossierReadAdapter(this.transport);
    this.reviewClient = new DossierReviewClient(this.transport);
    this.insights = new DossierInsightsClient(this.transport);
  }
  searchKnowledge(query: string, offset = 0) { return this.insights.search(query, offset); }
  economics(workId: string) { return this.insights.economics(workId); }
  async graph(paper: PaperCard) {
    const legacy = this.legacy.get(paper.paper_id);
    if (legacy?.legacy_relations) {
      const relations = legacy.legacy_relations;
      return { relations, total: relations.length, entity_count: new Set(relations.flatMap(r => [r.subject_id, r.object_id])).size };
    }
    return readPaperGraph(this.transport, paper);
  }
  private envelope(response: Response): Record<string, any> {
    if (response.status < 200 || response.status >= 300) throw new Error(`论文档案服务返回 ${response.status}，请重试`);
    const body = record(response.json);
    if (body.schema_version !== 1) throw schemaError();
    return body;
  }
  async list(query: string, sort: "updated" | "title", cursor = ""): Promise<PaperPage> {
    const dossierResponse = await this.transport(`/api/v1/dossiers?${new URLSearchParams({ q: query, offset: cursor || "0", limit: "24",
      sort: sort === "title" ? "title" : "updated_at", order: sort === "title" ? "asc" : "desc" })}`);
    if (dossierResponse.status !== 404 && dossierResponse.status !== 501) {
      if (dossierResponse.status !== 200) throw new Error(`论文档案服务返回 ${dossierResponse.status}，请重试`);
      const page = this.dossiers.listResponse(dossierResponse.json);
      this.mode = "dossiers"; this.legacy.clear(); return page;
    }
    const response = await this.transport(`/api/v1/library/papers?${new URLSearchParams({ query, sort, cursor, limit: "24" })}`);
    if (response.status === 404 || response.status === 501) {
      const old = await this.transport("/api/v1/knowledge?limit=500");
      if (old.status !== 200) throw new Error(`知识库读取失败 (${old.status})`);
      const snapshot = record(old.json); array(snapshot.relations); count(snapshot.total);
      for (const r of snapshot.relations) {
        record(r);
        for (const field of ["assertion_id", "source_uri", "paper_title", "subject_name", "object_name", "relation_type", "updated_at", "evidence_text", "source_question"]) string(r[field]);
      }
      const all = legacyPaperDetails(snapshot as unknown as PersonalKnowledgeSnapshot);
      this.legacy = new Map(all.map(p => [p.paper_id, p]));
      this.mode = "legacy";
      const papers = all.filter(p => p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      papers.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : (b.updated_at || "").localeCompare(a.updated_at || ""));
      return { papers, total: papers.length, next_cursor: null, mode: "legacy", legacy_limit: { shown: snapshot.relations.length, total: snapshot.total } };
    }
    const body = this.envelope(response); array(body.papers); body.papers.forEach(card); count(body.total); nullableString(body.next_cursor);
    if (new Set(body.papers.map((p: PaperCard) => p.paper_id)).size !== body.papers.length) throw schemaError();
    this.legacy.clear();
    this.mode = "library";
    return { papers: body.papers, total: body.total, next_cursor: body.next_cursor, mode: "native" };
  }
  async detail(id: string): Promise<PaperDetail> {
    if (this.mode === "dossiers") return this.dossiers.detail(id);
    const cached = this.legacy.get(id);
    if (cached) return cached;
    const body = this.envelope(await this.transport(`/api/v1/library/papers/${encodeURIComponent(id)}`));
    detail(body.paper);
    if (body.paper.paper_id !== id) throw schemaError();
    return body.paper;
  }
  async contributions(id: string, cursor: string): Promise<ContributionPage> {
    if (this.mode === "dossiers") return this.dossiers.contributions(id, cursor);
    const body = this.envelope(await this.transport(`/api/v1/library/papers/${encodeURIComponent(id)}/contributions?${new URLSearchParams({ cursor, limit: "20" })}`));
    contributionPage(body); return { contributions: body.contributions as QuestionContribution[], next_cursor: body.next_cursor };
  }
  async items(id: string, cursor: string) {
    if (this.mode !== "dossiers") throw new Error("当前接口不支持知识条目分页");
    return this.dossiers.items(id, cursor);
  }
  async bindLocations(paperId: string, draft: DraftSelection, fileHash: string): Promise<void> {
    if (this.mode !== "dossiers") throw schemaError();
    const path = `/api/v1/dossiers/documents/${encodeURIComponent(paperId)}/locations`;
    const current = await this.transport(path);
    const legacy = current.status === 400 && record(current.json).error === "Unknown registered document";
    if (current.status !== 200 && !legacy) throw new Error("无法读取原文绑定，请更新服务并刷新卡片");
    const stored = legacy ? { paper_id: paperId, revision: null } : record(current.json);
    if (stored.paper_id !== paperId || (stored.revision !== null && (!Number.isSafeInteger(stored.revision) || stored.revision < 1))) throw schemaError();
    const result = await this.transport(path, { text: draft.text, segments: draft.segments,
      file_binding: { source_path: draft.sourcePath }, snapshot: { file_sha256: fileHash }, revision: stored.revision });
    if (result.status === 409) throw new Error("原文版本或绑定已变化，未覆盖。请核对文件并刷新卡片");
    if (result.status !== 200) throw new Error(`原文关联未完成 (${result.status})，请刷新后核对`);
    const saved = record(result.json);
    if (saved.paper_id !== paperId || !Number.isSafeInteger(saved.revision) || saved.revision < 1) throw schemaError();
  }
}
