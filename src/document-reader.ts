import { App, TFile, loadPdfJs } from "obsidian";
import { DocumentSegment, DraftSelection } from "./contracts";

const TARGET_SEGMENT_CHARACTERS = 900;
const MAX_SEGMENT_CHARACTERS = 1_400;
const MAX_DOCUMENT_CHARACTERS = 1_500_000;

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

export async function readActiveDocument(app: App): Promise<DraftSelection> {
  const file = app.workspace.getActiveFile();
  if (!file) throw new Error("请先打开一篇 Markdown 或 PDF 文档");

  const extension = file.extension.toLocaleLowerCase();
  if (extension === "md") return readMarkdownDocument(app, file);
  if (extension === "pdf") return readPdfDocument(app, file);
  throw new Error("当前仅支持对 Markdown 和 PDF 文档直接提问");
}

async function readMarkdownDocument(app: App, file: TFile): Promise<DraftSelection> {
  const text = await app.vault.cachedRead(file);
  if (!text.trim()) throw new Error("当前 Markdown 文档没有可提问的正文");
  assertDocumentSize(text);
  return {
    text,
    sourcePath: file.path,
    title: file.basename,
    sourceType: "markdown",
    segments: markdownSegments(text)
  };
}

async function readPdfDocument(app: App, file: TFile): Promise<DraftSelection> {
  const pdfjs = await loadPdfJs();
  const bytes = await app.vault.readBinary(file);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;
  const segments: DocumentSegment[] = [];
  let characterCount = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageSegments = pdfPageSegments(
        content.items as PdfTextItem[],
        pageNumber
      );
      for (const segment of pageSegments) {
        characterCount += segment.text.length;
        if (characterCount > MAX_DOCUMENT_CHARACTERS) {
          throw new Error("PDF 正文超过 150 万字符，请拆分文档后再提问");
        }
        segments.push(segment);
      }
      page.cleanup?.();
    }
  } finally {
    await loadingTask.destroy?.();
  }

  if (!segments.length) {
    throw new Error("没有从 PDF 读取到文字；扫描版 PDF 需要先进行 OCR");
  }
  return {
    text: segments.map((segment) => segment.text).join("\n"),
    sourcePath: file.path,
    title: file.basename,
    sourceType: "pdf",
    segments
  };
}

function markdownSegments(text: string): DocumentSegment[] {
  const lines = text.split(/\r?\n/);
  const result: DocumentSegment[] = [];
  let current: string[] = [];
  let lineStart = 1;

  const flush = (lineEnd: number): void => {
    const value = current.join("\n").trim();
    if (value) {
      result.push({
        text: value,
        locator: { kind: "markdown", line_start: lineStart, line_end: lineEnd },
        location_label:
          lineStart === lineEnd ? `第 ${lineStart} 行` : `第 ${lineStart}-${lineEnd} 行`
      });
    }
    current = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (!line.trim()) {
      flush(lineNumber - 1);
      lineStart = lineNumber + 1;
      continue;
    }
    if (!current.length) lineStart = lineNumber;
    current.push(line);
    const length = current.join("\n").length;
    if (
      length >= MAX_SEGMENT_CHARACTERS ||
      (length >= TARGET_SEGMENT_CHARACTERS && /[。！？.!?]\s*$/.test(line))
    ) {
      flush(lineNumber);
      lineStart = lineNumber + 1;
    }
  }
  flush(lines.length);
  return result;
}

function pdfPageSegments(items: PdfTextItem[], page: number): DocumentSegment[] {
  const result: DocumentSegment[] = [];
  let textParts: string[] = [];
  let beginIndex = -1;
  let endIndex = -1;
  let endOffset = 0;

  const flush = (): void => {
    const text = textParts.join(" ").replace(/\s+/g, " ").trim();
    if (text && beginIndex >= 0 && endIndex >= beginIndex) {
      result.push({
        text,
        locator: {
          kind: "pdf",
          page,
          begin_index: beginIndex,
          begin_offset: 0,
          end_index: endIndex,
          end_offset: endOffset
        },
        location_label: `第 ${page} 页`
      });
    }
    textParts = [];
    beginIndex = -1;
    endIndex = -1;
    endOffset = 0;
  };

  for (let index = 0; index < items.length; index += 1) {
    const value = String(items[index]?.str ?? "").trim();
    if (!value) continue;
    if (beginIndex < 0) beginIndex = index;
    textParts.push(value);
    endIndex = index;
    endOffset = String(items[index]?.str ?? "").length;
    const length = textParts.reduce((total, part) => total + part.length + 1, 0);
    const sentenceEnd = /[。！？.!?]\s*$/.test(value);
    if (
      length >= MAX_SEGMENT_CHARACTERS ||
      (length >= TARGET_SEGMENT_CHARACTERS && (sentenceEnd || items[index].hasEOL))
    ) {
      flush();
    }
  }
  flush();
  return result;
}

function assertDocumentSize(text: string): void {
  if (text.length > MAX_DOCUMENT_CHARACTERS) {
    throw new Error("文档正文超过 150 万字符，请拆分文档后再提问");
  }
}
