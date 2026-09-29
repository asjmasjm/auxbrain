import type { QuestionContribution } from "./paper-library-contracts";
import { labelRelation, labelPolarity } from "./contracts";

export function contributionGroups(changes: QuestionContribution["changes"]) {
  const groups = new Map<string, { kind: QuestionContribution["changes"][number]["kind"]; section: QuestionContribution["changes"][number]["section_key"]; items: Set<string> }>();
  for (const change of changes) {
    const key = `${change.section_key ?? ""}:${change.kind}`;
    const group = groups.get(key) ?? { kind: change.kind, section: change.section_key, items: new Set<string>() };
    group.items.add(change.item_id); groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ kind: group.kind, section: group.section, count: group.items.size }));
}

const conditionNames: Record<string, string> = { stage: "阶段", dataset: "数据集", datasets: "数据集", model: "模型", task: "任务", platform: "平台", variant: "版本", setting: "设置", conditions: "条件", note: "备注", subject: "关系主体", relation: "关系", object: "关联实体", polarity: "肯否判断", enabled: "是否启用", field: "属性", value: "取值", cardinality: "取值数量", benchmark: "评测基准", split: "数据划分", metric: "指标", language: "语言", source: "来源", scope: "适用范围" };
const conditionName = (name: string) => conditionNames[name] || (/\p{Script=Han}/u.test(name) ? name : "其他条件");
function conditionValue(value: unknown, key = ""): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(v => conditionValue(v, key)).join("、") || "未填写";
  if (typeof value === "object") return Object.entries(value).map(([key, v]) => `${conditionName(key)}：${conditionValue(v, key)}`).join("；") || "未填写";
  if (key === "relation") return labelRelation(String(value));
  if (key === "polarity") return labelPolarity(String(value));
  const stages: Record<string, string> = { training: "训练", pretraining: "预训练", finetuning: "微调", evaluation: "评测", testing: "测试", inference: "推理", deployment: "部署" };
  if (key === "stage") return stages[String(value)] || String(value);
  if (key === "cardinality" && value === "one") return "单值";
  return String(value);
}
export function scopeRows(scope: Record<string, unknown>) {
  return Object.entries(scope).filter(([key]) => !["answer_approval", "answer_part"].includes(key)).map(([key, value]) => ({ label: conditionName(key), value: conditionValue(value, key) }));
}

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
export function isSourceExcerpt(statement: string, quotes: string[]): boolean {
  const value = normalize(statement);
  return !!value && quotes.some(quote => normalize(quote) === value);
}

export function knowledgeLabel(excerpt: boolean, status: string): string {
  if (!excerpt) return "知识结论";
  return status === "candidate" ? "待整理的原文" : "保存的原文";
}

export function sourcePreview(text: string): string {
  const chars = Array.from(normalize(text));
  return chars.slice(0, 100).join("") + (chars.length > 100 ? "..." : "");
}

export function renderKnowledgeText(parent: HTMLElement, text: string, quote = false): void {
  const chars = Array.from(text);
  let target = parent;
  if (chars.length > 240) {
    const details = document.createElement("details"); details.className = "ab-text-fold";
    const summary = document.createElement("summary");
    const preview = document.createElement("span"); preview.className = "ab-text-preview";
    preview.textContent = chars.slice(0, 160).join("").replace(/\s+/gu, " ") + "...";
    const toggle = document.createElement("span"); toggle.className = "ab-text-toggle";
    toggle.textContent = "展开全文";
    summary.append(preview, toggle); details.append(summary); parent.append(details); target = details;
  }
  const content = document.createElement(quote ? "blockquote" : "p");
  content.className = "ab-knowledge-text"; content.textContent = text; target.append(content);
}
