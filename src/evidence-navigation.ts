import { App, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { DraftSelection, UnderstandingEvidence } from "./contracts";

interface TextPosition {
  node: Text;
  offset: number;
}

interface TextIndex {
  text: string;
  positions: TextPosition[];
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}

const EVIDENCE_HIGHLIGHT = "auxbrain-evidence";
let highlightTimeout: number | null = null;

export async function navigateToEvidence(
  app: App,
  draft: DraftSelection,
  evidence: UnderstandingEvidence
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(draft.sourcePath);
  if (!(file instanceof TFile)) throw new Error("找不到证据对应的源文档");

  const kind = evidence.locator?.kind ?? draft.sourceType;
  if (kind === "pdf") {
    await openPdfEvidence(app, file, evidence);
    return;
  }
  if (kind === "markdown") {
    await openMarkdownEvidence(app, file, evidence);
    return;
  }
  throw new Error("这条证据没有可导航的位置信息");
}

async function openPdfEvidence(
  app: App,
  file: TFile,
  evidence: UnderstandingEvidence
): Promise<void> {
  const page = positiveInteger(evidence.locator.page);
  if (!page) throw new Error("PDF 证据缺少页码");
  const selection = pdfSelection(evidence);
  let leaf = findFileLeaf(app, file.path);
  if (!leaf) {
    leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const subpath = `#page=${page}${selection ? `&selection=${selection}` : ""}`;
  await app.workspace.openLinkText(`${file.path}${subpath}`, "", false);

  const targetLeaf = findFileLeaf(app, file.path) ?? leaf;
  const highlighted = await waitForPdfEvidence(targetLeaf, page, evidence.text);
  if (!highlighted && !selection) {
    new Notice(`已定位到第 ${page} 页，但没有找到可高亮的证据原文`);
  }
}

async function openMarkdownEvidence(
  app: App,
  file: TFile,
  evidence: UnderstandingEvidence
): Promise<void> {
  let leaf = findFileLeaf(app, file.path);
  if (!leaf) {
    leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  if (!(leaf.view instanceof MarkdownView)) {
    throw new Error("无法打开 Markdown 证据位置");
  }

  const view = leaf.view;
  if (view.getMode() === "source") {
    const lastLine = Math.max(0, view.editor.lineCount() - 1);
    const startLine = Math.min(
      lastLine,
      Math.max(0, positiveInteger(evidence.locator.line_start) - 1)
    );
    const endLine = Math.min(
      lastLine,
      Math.max(startLine, positiveInteger(evidence.locator.line_end) - 1)
    );
    const from = { line: startLine, ch: 0 };
    const to = { line: endLine, ch: view.editor.getLine(endLine).length };
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
    view.editor.focus();
    return;
  }

  const root = view.containerEl.querySelector<HTMLElement>(
    ".markdown-preview-view, .markdown-rendered"
  );
  if (!root || !highlightRenderedText(root, evidence.text)) {
    new Notice("已打开源文档，但阅读视图未找到完整证据；可切换到编辑视图重试");
  }
}

function findFileLeaf(app: App, sourcePath: string): WorkspaceLeaf | null {
  const candidates = [
    ...app.workspace.getLeavesOfType("markdown"),
    ...app.workspace.getLeavesOfType("pdf")
  ];
  return (
    candidates.find((leaf) => {
      const view = leaf.view as unknown as { file?: TFile };
      return view.file?.path === sourcePath;
    }) ?? null
  );
}

function pdfSelection(evidence: UnderstandingEvidence): string {
  const values = [
    evidence.locator.begin_index,
    evidence.locator.begin_offset,
    evidence.locator.end_index,
    evidence.locator.end_offset
  ];
  if (!values.every((value) => Number.isInteger(value) && Number(value) >= 0)) {
    return "";
  }
  return values.map(Number).join(",");
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function highlightRenderedText(root: HTMLElement, evidenceText: string): boolean {
  const targets = [
    normalizeText(evidenceText),
    normalizeText(markdownToPlainText(evidenceText))
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  if (!targets.length) return false;

  for (const compactWhitespace of [false, true]) {
    const index = renderedTextIndex(root, compactWhitespace);
    const comparableTargets = targets.map((target) =>
      compactWhitespace ? target.replace(/\s+/g, "") : target
    );
    const range = matchingRange(index, comparableTargets);
    if (range) {
      showEvidenceHighlight(range);
      return true;
    }
  }
  return false;
}

async function waitForPdfEvidence(
  leaf: WorkspaceLeaf,
  page: number,
  evidenceText: string
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const root of pdfTextLayers(leaf, page)) {
      if (highlightRenderedText(root, evidenceText)) return true;
    }
    await delay(125);
  }
  return false;
}

function pdfTextLayers(leaf: WorkspaceLeaf, page: number): HTMLElement[] {
  const container = leaf.view.containerEl;
  const exact = Array.from(
    container.querySelectorAll<HTMLElement>(
      `.page[data-page-number="${page}"] .textLayer, ` +
        `.pdf-page[data-page-number="${page}"] .textLayer, ` +
        `.page[data-page-number="${page}"] .text-layer, ` +
        `.pdf-page[data-page-number="${page}"] .text-layer`
    )
  );
  const all = Array.from(
    container.querySelectorAll<HTMLElement>(".textLayer, .text-layer")
  );
  const ordered = [...exact];
  const indexed = all[page - 1];
  if (indexed && !ordered.includes(indexed)) ordered.push(indexed);
  for (const layer of all) {
    if (!ordered.includes(layer)) ordered.push(layer);
  }
  return ordered;
}

function renderedTextIndex(root: HTMLElement, compactWhitespace: boolean): TextIndex {
  const positions: TextPosition[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const parent = node.parentElement;
    if (parent && !parent.closest("script, style, .mod-ui")) {
      const block = parent.closest(
        "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th"
      );
      if (
        block &&
        previousBlock &&
        block !== previousBlock &&
        text &&
        !text.endsWith(" ") &&
        !compactWhitespace
      ) {
        text += " ";
        positions.push({ node, offset: 0 });
      }
      for (let offset = 0; offset < node.data.length; offset += 1) {
        const character = node.data[offset];
        if (/\s/.test(character)) {
          if (!compactWhitespace && text && !text.endsWith(" ")) {
            text += " ";
            positions.push({ node, offset });
          }
          continue;
        }
        text += character;
        positions.push({ node, offset });
      }
      if (block) previousBlock = block;
    }
    current = walker.nextNode();
  }
  return { text: text.trim(), positions };
}

function matchingRange(index: TextIndex, targets: string[]): Range | null {
  const comparableText = index.text.toLocaleLowerCase();
  const target = targets.find((candidate) =>
    comparableText.includes(candidate.toLocaleLowerCase())
  );
  if (!target) return null;
  const start = comparableText.indexOf(target.toLocaleLowerCase());
  if (start < 0) return null;
  const end = start + target.length - 1;
  const from = index.positions[start];
  const to = index.positions[end];
  if (!from || !to) return null;

  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset + 1);
  return range;
}

function showEvidenceHighlight(range: Range): void {
  const from = range.startContainer as Text;
  from.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });

  const cssHighlights = (
    window as unknown as { CSS?: { highlights?: HighlightRegistry } }
  ).CSS?.highlights;
  const HighlightConstructor = (window as unknown as { Highlight?: new (range: Range) => unknown })
    .Highlight;
  if (cssHighlights && HighlightConstructor) {
    cssHighlights.set(EVIDENCE_HIGHLIGHT, new HighlightConstructor(range));
    if (highlightTimeout !== null) window.clearTimeout(highlightTimeout);
    highlightTimeout = window.setTimeout(() => {
      cssHighlights.delete(EVIDENCE_HIGHLIGHT);
      highlightTimeout = null;
    }, 12_000);
  } else {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function markdownToPlainText(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~>|]/g, "")
    .trim();
}
