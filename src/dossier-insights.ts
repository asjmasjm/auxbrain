import { mapEvidence } from "./dossier-adapter";
import { parseReviewItem } from "./dossier-review-client";
import type { PaperEvidence } from "./paper-library-contracts";

export interface KnowledgeHit {
  workId: string; paperId: string; itemId: string; title: string; statement: string;
  scope: Record<string, unknown>; evidence: PaperEvidence[];
}
export interface KnowledgeSearchPage { items: KnowledgeHit[]; total: number; offset: number; limit: number; relatedWorks: number; }
export interface PaperEconomics {
  workId: string; trackingAvailable: boolean; complete: boolean; unknownCount: number;
  stages: Record<string, { input: number; output: number; total: number }>;
  total: number; reused: number;
}
export class InsightsUnavailable extends Error {
  constructor() { super("当前 Companion 不支持此功能，请更新并重启本地服务"); }
}
type Transport = (path: string) => Promise<{ status: number; json: unknown }>;
const invalid = () => new Error("知识检索或用量数据格式不兼容，请更新本地服务");
function obj(v: unknown): Record<string, any> { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v as Record<string, any>; }
function text(v: unknown): string { if (typeof v !== "string") throw invalid(); return v; }
function count(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0) throw invalid(); return Number(v); }
function bool(v: unknown): boolean { if (typeof v !== "boolean") throw invalid(); return v; }

export function parseKnowledgeSearch(raw: unknown, query: string, offset: number, limit: number): KnowledgeSearchPage {
  const r = obj(raw);
  if (r.version !== "cross-card-discovery-v1" || r.query !== query || r.offset !== offset || r.limit !== limit
    || !Array.isArray(r.items) || r.items.length > limit || r.creates_facts !== false || r.provider_calls !== 0) throw invalid();
  const total = count(r.total), relatedWorks = count(r.related_work_count);
  if (r.items.length && offset + r.items.length > total || !r.items.length && offset < total || relatedWorks > total) throw invalid();
  const ids = new Set<string>();
  const items = r.items.map((value: unknown): KnowledgeHit => {
    const hit = obj(value), workId = text(hit.work_id), paperId = text(hit.paper_id), item = parseReviewItem(hit.item, workId);
    const id = JSON.stringify([workId, item.itemId]);
    if (!workId || !paperId || ids.has(id) || item.paperId !== paperId || item.status !== "confirmed" || item.kind !== "paper_statement") throw invalid();
    ids.add(id);
    return { workId, paperId, itemId: item.itemId, title: text(hit.title), statement: item.statement, scope: item.scope,
      evidence: hit.item.evidence.map((e: unknown, i: number) => mapEvidence(obj(e), { source_uri: "" }, item.itemId, i)) };
  });
  // Shared-query connections are intentionally not converted into knowledge or relation edges.
  return { items, total, relatedWorks, offset, limit };
}
export function parseEconomics(raw: unknown, workId: string): PaperEconomics {
  const r = obj(raw);
  if (r.version !== "dossier-economics-v1" || r.work_id !== workId || !Array.isArray(r.unknown_usage)) throw invalid();
  const stages: PaperEconomics["stages"] = {};
  for (const [key, value] of Object.entries(obj(r.known_tokens_by_stage))) {
    const v = obj(value), input = count(v.input_tokens), output = count(v.output_tokens), total = count(v.total_tokens);
    if (input + output !== total) throw invalid();
    Object.defineProperty(stages, key, { value: { input, output, total }, enumerable: true });
  }
  const total = count(r.known_total_tokens);
  if (Object.values(stages).reduce((n, s) => n + s.total, 0) !== total) throw invalid();
  return { workId, trackingAvailable: bool(r.tracking_available), complete: bool(r.complete_billing_account),
    unknownCount: r.unknown_usage.length, stages, total, reused: count(r.reused_build_jobs) };
}
export class DossierInsightsClient {
  constructor(private transport: Transport) {}
  private async get(path: string, knowledgeRoute = false): Promise<unknown> {
    const response = await this.transport(path);
    if (response.status === 404 || response.status === 501) throw new InsightsUnavailable();
    // Older dispatchers interpret /knowledge as a work ID instead of an unknown route.
    if (knowledgeRoute && response.status === 400 && response.json && typeof response.json === "object"
      && (response.json as { error?: unknown }).error === "Unknown work_id") throw new InsightsUnavailable();
    if (response.status !== 200) throw new Error(`本地服务读取失败 (${response.status})`);
    return response.json;
  }
  async search(query: string, offset = 0): Promise<KnowledgeSearchPage> {
    query = query.trim();
    if (!query || query.length > 4000 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("请输入有效的检索关键词");
    const limit = 20;
    return parseKnowledgeSearch(await this.get(`/api/v1/dossiers/knowledge?${new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })}`, true), query, offset, limit);
  }
  async economics(workId: string): Promise<PaperEconomics> {
    return parseEconomics(await this.get(`/api/v1/dossiers/${encodeURIComponent(workId)}/economics`), workId);
  }
}
