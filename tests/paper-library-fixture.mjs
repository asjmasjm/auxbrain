// Synthetic test-only data. Never imported by src/ or distributed in main.js.
export const keys = ["background", "related_work", "improvements", "method", "experiment_setup", "results", "ablations", "limitations_future_work"];
export function makePaper(id = "test-paper-a", title = "测试论文：长时序机器人操作与可验证的实验结论") {
  return {
    paper_id: id, title, source_path: "test-paper.pdf", updated_at: "2026-09-27T09:00:00Z",
    metadata: {
      arxiv_id: null, doi: null,
      authors: [{ name: "Test Author", affiliations: ["Synthetic Research Lab"] }],
      publication: { status: "unknown", venue: null, date: null },
      versions: [{ version: "v1", date: "2026-01-01", url: null }], sources: []
    },
    counts: { questions: 3, confirmed: 2, candidate: 1, explored_sections: 2 },
    sections: keys.map(key => ({ key, status: key === "method" ? "partial" : "unexplored", items: key === "method" ? [{
      item_id: "item-1", text: "测试知识：该方法分阶段训练策略，具体适用范围仍需核对。", status: "candidate", confidence: 0.74,
      source_question_ids: ["question-1"], evidence: [{
        evidence_id: "evidence-1", text: "Synthetic source evidence, not an actual research finding.",
        source_path: "test-paper.pdf", location_label: "第 3 页", locator: { kind: "pdf", page: 3 }, revision: "v1"
      }]
    }] : [] })),
    contributions: { next_cursor: "questions-page-2", contributions: [{
      understanding_id: "question-1", question: "测试问题：本文方案是什么？", asked_at: "2026-09-27T09:00:00Z", status: "completed",
      changes: [{ kind: "added", item_id: "item-1", section_key: "method", summary: "训练流程" }]
    }, { understanding_id: "question-2", question: "重复测试问题", asked_at: "2026-09-27T09:01:00Z", status: "completed", changes: [] }] }
  };
}
export function legacyRelation(id, uri = "obsidian://test-paper.pdf") {
  return { assertion_id: id, source_uri: uri, paper_title: "同名论文", subject_type: "paper", subject_id: "p",
    subject_name: "Policy", subject_entity_type: "paper", relation_type: "evaluated_on", object_id: "dataset",
    object_name: "Test Set", entity_type: "dataset", confidence: 0.8, evidence_text: "Test source text.",
    assignment_method: "human", updated_at: "2026-09-27 09:00:00", polarity: "asserted",
    source_understanding_id: "old-question", source_question: "在哪评测？", source_answer: "Test answer" };
}
