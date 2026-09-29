import { setIcon } from "obsidian";
import type { DossierReviews, ReviewItem } from "./dossier-review-client";
import type { ContributionPage } from "./paper-library-contracts";
import { knowledgeRelation, renderKnowledgeRelation } from "./knowledge-relation";

export interface AnswerKnowledgeSource {
  contributions(work: string, cursor: string): Promise<ContributionPage>;
  reviews?: DossierReviews;
}
export async function answerRelations(source: AnswerKnowledgeSource, work: string, answer: string): Promise<ReviewItem[]> {
  if (!source.reviews) throw new Error("当前本地服务不支持读取提炼的关系");
  let cursor: string | null = "0";
  const visited = new Set<string>(), ids = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) throw new Error("提问记录分页异常，请刷新后重试");
    visited.add(cursor);
    const page: ContributionPage = await source.contributions(work, cursor);
    for (const question of page.contributions) {
      if (question.source_understanding_id !== answer) continue;
      for (const change of question.changes) ids.add(change.item_id);
    }
    cursor = page.next_cursor;
  }
  const items: ReviewItem[] = [];
  for (const id of ids) {
    const item = await source.reviews.item(work, id);
    if (item.workId !== work || item.itemId !== id) throw new Error("关系所属论文不一致，未展示结果");
    if (["candidate", "confirmed", "conflict"].includes(item.status) && knowledgeRelation(item.scope)) items.push(item);
  }
  return items;
}

export class AnswerKnowledgePanel {
  private root: HTMLElement | null = null;
  private disposed = false;
  private busy = false;
  private loaded = false;
  private error = "";
  private items: ReviewItem[] = [];
  constructor(private source: AnswerKnowledgeSource, private work: string, private answer: string) {}
  mount(root: HTMLElement) { this.root = root; this.render(); if (!this.loaded) void this.load(); }
  dispose() { this.disposed = true; this.root = null; }
  private async load() {
    if (this.busy || this.disposed) return;
    this.busy = true; this.loaded = true; this.error = ""; this.items = []; this.render();
    try { const items = await answerRelations(this.source, this.work, this.answer); if (!this.disposed) this.items = items; }
    catch (error) { if (!this.disposed) this.error = error instanceof Error ? error.message : "提炼关系读取失败"; }
    finally { this.busy = false; this.render(); }
  }
  private render() {
    if (!this.root || this.disposed) return;
    const root = this.root; root.replaceChildren(); root.className = "ab-answer-knowledge";
    const heading = document.createElement("h3"); heading.textContent = "本次回答提炼的关系"; root.append(heading);
    const status = document.createElement("p"); status.setAttribute("role", this.error ? "alert" : "status");
    status.textContent = this.busy ? "正在读取提炼结果" : this.error || (this.items.length ? "回答认可与实体关系审核分别记录" : "尚无关联到本次回答的结构化实体关系"); root.append(status);
    for (const item of this.items) renderKnowledgeRelation(root, item.scope, item.status);
    const refresh = document.createElement("button"); refresh.type = "button"; refresh.className = "clickable-icon";
    refresh.title = "刷新提炼结果"; refresh.setAttribute("aria-label", refresh.title); refresh.disabled = this.busy;
    setIcon(refresh, this.busy ? "loader-circle" : "refresh-cw"); refresh.onclick = () => void this.load(); root.append(refresh);
  }
}
