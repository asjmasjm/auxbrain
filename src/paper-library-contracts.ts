import { EvidenceLocator, PersonalKnowledgeRelation } from "./contracts";
import type { DossierReviews, ReviewItem } from "./dossier-review-client";
import type { KnowledgeSearchPage, PaperEconomics } from "./dossier-insights";

export const PAPER_SECTIONS = {
  background: "研究背景与问题", related_work: "相关工作", improvements: "相对其他方法的改进",
  method: "本文方案", experiment_setup: "实验设置", results: "主要实验结论",
  ablations: "消融实验", limitations_future_work: "局限与未来工作"
} as const;
export type PaperSectionKey = keyof typeof PAPER_SECTIONS;
export type SectionStatus = "unexplored" | "candidate" | "partial" | "confirmed" | "conflict" | "not_reported" | "stale";
export type ReviewState = "candidate" | "confirmed" | "conflict" | "withdrawn" | "stale";
export interface MetadataSource { label: string; url: string | null; retrieved_at: string | null; }
export interface PaperMetadata {
  arxiv_id: string | null; doi: string | null;
  authors: Array<{ name: string; affiliations: string[] }>;
  publication: { status: "unknown" | "preprint" | "accepted" | "published"; venue: string | null; date: string | null };
  versions: Array<{ version: string; date: string | null; url: string | null }>;
  sources: MetadataSource[];
}
export interface PaperCard {
  question_count_scope?: "dossier_linked";
  paper_id: string; title: string; source_path: string | null;
  metadata: PaperMetadata;
  counts: { questions: number | null; confirmed: number; candidate: number | null; explored_sections: number | null };
  updated_at: string | null;
}
export interface PaperEvidence {
  source_paper_id?: string;
  location_status?: "locatable" | "missing_location" | "source_changed" | "ambiguous";
  snapshot?: { file_sha256?: string; supplied_text_sha256?: string };
  evidence_id: string; text: string; source_path: string | null;
  location_label: string; locator: EvidenceLocator; revision: string | null;
}
export interface PaperKnowledgeItem {
  review?: ReviewItem;
  item_id: string; text: string; status: ReviewState; confidence: number | null;
  kind?: "paper_statement" | "personal_note" | "inference";
  evidence: PaperEvidence[]; source_question_ids: string[];
}
export interface PaperSection { key: PaperSectionKey; status: SectionStatus; items: PaperKnowledgeItem[]; }
export interface QuestionContribution {
  source_understanding_id?: string;
  job_id?: string | null;
  understanding_id: string; question: string; asked_at: string; status: "pending" | "completed" | "failed" | "unknown";
  changes: Array<{ kind: "added" | "supported" | "corrected" | "withdrawn" | "revealed" | "unchanged" | "confirmed" | "conflict"; item_id: string; section_key: PaperSectionKey | null; summary: string }>;
}
export interface ContributionPage { contributions: QuestionContribution[]; next_cursor: string | null; }
export interface PaperItemPage { sections: PaperSection[]; total: number; next_cursor: string | null; }
export interface PaperDetail extends PaperCard {
  sections: PaperSection[];
  contributions: ContributionPage;
  legacy_relations?: PersonalKnowledgeRelation[];
  items_page?: { loaded: number; total: number; next_cursor: string | null };
}
export interface PaperPage {
  papers: PaperCard[]; total: number; next_cursor: string | null;
  mode: "native" | "legacy";
  sorting?: boolean;
  legacy_limit?: { shown: number; total: number };
}
export interface PaperLibraryDataSource {
  searchKnowledge?(query: string, offset?: number): Promise<KnowledgeSearchPage>;
  economics?(workId: string): Promise<PaperEconomics>;
  readonly reviews?: DossierReviews;
  list(query: string, sort: "updated" | "title", cursor?: string): Promise<PaperPage>;
  detail(id: string): Promise<PaperDetail>;
  contributions(id: string, cursor: string): Promise<ContributionPage>;
  items?(id: string, cursor: string): Promise<PaperItemPage>;
}
