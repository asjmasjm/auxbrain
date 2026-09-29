import { setIcon } from "obsidian";
import { labelRelation, labelPolarity } from "./contracts";

export interface KnowledgeRelation { subject: string; relation: string; object: string; polarity: string; }
export function knowledgeRelation(scope: Record<string, unknown>): KnowledgeRelation | null {
  const { subject, relation, object, polarity } = scope;
  if (![subject, relation, object, polarity].every(v => typeof v === "string" && v.trim())) return null;
  if (!['asserted', 'negated', 'uncertain'].includes(polarity as string)) return null;
  if (labelRelation(relation as string) === "待识别关系") return null;
  return { subject: subject as string, relation: relation as string, object: object as string, polarity: polarity as string };
}
export function importedRelationStatement(statement: string, scope: Record<string, unknown>): boolean {
  const r = knowledgeRelation(scope);
  return !!r && statement === `${r.subject}: ${r.relation} ${r.object} (${r.polarity}).`;
}
export function editableKnowledgeStatement(statement: string, scope: Record<string, unknown>): string {
  const r = knowledgeRelation(scope);
  if (!r || !importedRelationStatement(statement, scope)) return statement;
  return `${r.subject}：${labelPolarity(r.polarity)}，${labelRelation(r.relation)} ${r.object}。`;
}
export function correctedScope(scope: Record<string, unknown>, changed: boolean): Record<string, unknown> {
  const next = structuredClone(scope);
  // A free-text correction cannot validate the old relation or answer approval marker.
  if (changed) for (const key of ['subject', 'relation', 'object', 'polarity', 'answer_approval', 'answer_part']) delete next[key];
  return next;
}
export function renderKnowledgeRelation(parent: HTMLElement, scope: Record<string, unknown>, status: string): boolean {
  const r = knowledgeRelation(scope);
  if (!r) return false;
  const root = document.createElement('div'); root.className = 'ab-knowledge-relation'; parent.append(root);
  const state = document.createElement('p'); state.className = 'ab-knowledge-meta';
  state.textContent = status === 'confirmed' ? '已确认的实体关系' : status === 'candidate' ? '提炼的实体关系 · 待你同意' : '实体关系 · 待重新核对'; root.append(state);
  const graph = document.createElement('div'); graph.className = 'ab-relation-path'; root.append(graph);
  const entity = (name: string, label: string) => {
    const details = document.createElement('details'); details.className = 'ab-relation-entity';
    const summary = document.createElement('summary'); summary.textContent = name; details.append(summary);
    const info = document.createElement('p'); info.textContent = `${label}：${name}`; details.append(info); graph.append(details);
  };
  entity(r.subject, '关系主体');
  const edge = document.createElement('div'); edge.className = 'ab-relation-edge'; graph.append(edge);
  const label = document.createElement('span'); label.textContent = `${labelPolarity(r.polarity)} · ${labelRelation(r.relation)}`; edge.append(label);
  const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); setIcon(arrow, 'arrow-right'); edge.append(arrow);
  entity(r.object, '关联实体');
  return true;
}
