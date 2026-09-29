import type { PersonalKnowledgeRelation, PersonalKnowledgeSnapshot } from "./contracts";
import type { PaperCard } from "./paper-library-contracts";
type Transport = (path: string) => Promise<{ status: number; json: unknown }>;

export async function readPaperGraph(transport: Transport, paper: PaperCard): Promise<PersonalKnowledgeSnapshot> {
  const relations: PersonalKnowledgeRelation[] = [];
  const seen = new Set<string>();
  let offset = 0, total = 0;
  do {
    const response = await transport(`/api/v1/dossiers/${encodeURIComponent(paper.paper_id)}/facts?limit=100&offset=${offset}`);
    if (response.status !== 200) throw new Error(`论文图谱读取失败 (${response.status})，未显示其他论文的关系`);
    const r = response.json as any;
    if (!r || !Array.isArray(r.facts) || r.offset !== offset || !Number.isSafeInteger(r.total) || r.total < 0
      || r.facts.length > 100 || !r.facts.length && offset < r.total) throw new Error("论文图谱分页格式不兼容");
    total = r.total;
    for (const f of r.facts) {
      if (!f || typeof f.assertion_id !== "string" || seen.has(f.assertion_id) || typeof f.paper_id !== "string"
        || !["subject_type", "subject_id", "object_id", "canonical_name", "relation_type", "polarity", "evidence_text"].every(k => typeof f[k] === "string")) throw new Error("论文图谱数据不兼容");
      seen.add(f.assertion_id);
      if (["retracted", "stale", "conflict", "unavailable"].includes(f.dossier_review_status)) continue;
      relations.push({ assertion_id: f.assertion_id, paper_id: f.paper_id, subject_type: f.subject_type, subject_id: f.subject_id,
        subject_name: f.subject_name || (f.subject_type === "paper" ? paper.title : f.subject_id), subject_entity_type: f.subject_entity_type || f.subject_type,
        object_id: f.object_id, object_name: f.canonical_name, entity_type: f.entity_type || "entity", relation_type: f.relation_type,
        polarity: f.polarity, confidence: typeof f.confidence === "number" ? f.confidence : 0,
        evidence_text: f.evidence_text, assignment_method: f.assignment_method || "", updated_at: f.updated_at || "",
        source_understanding_id: "", source_question: "", source_answer: "", paper_title: f.paper_title || paper.title, source_uri: f.source_uri || "" });
    }
    offset += r.facts.length;
  } while (offset < total);
  const entities = new Set(relations.flatMap(r => [`${r.subject_type}:${r.subject_id}`, `entity:${r.object_id}`]));
  return { relations, total: relations.length, entity_count: entities.size };
}
