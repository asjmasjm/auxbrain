import { App, TFile } from "obsidian";
import { readDocument } from "./document-reader";
import { PaperEvidence } from "./paper-library-contracts";

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(value => value.toString(16).padStart(2, "0")).join("");
}
export function matchesSnapshot(source: PaperEvidence, hashes: { file: string; text?: string }): boolean {
  // File bytes and extracted text are distinct hashes; never compare the server's JSON digest here.
  if (source.snapshot?.file_sha256) return source.snapshot.file_sha256.toLowerCase() === hashes.file;
  return !!source.snapshot?.supplied_text_sha256 && source.snapshot.supplied_text_sha256.toLowerCase() === hashes.text;
}
function fileFor(app: App, source: PaperEvidence): TFile {
  const path = source.source_path;
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes(":") || path.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error("缺少有效的库内文件路径");
  }
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || !["pdf", "md"].includes(file.extension.toLowerCase())) throw new Error("当前库中找不到对应 PDF 或 Markdown 原文");
  return file;
}
export async function prepareEvidenceBinding(app: App, source: PaperEvidence) {
  const file = fileFor(app, source);
  const before = await sha256(await app.vault.readBinary(file));
  const draft = await readDocument(app, file);
  const fileHash = await sha256(await app.vault.readBinary(file));
  if (before !== fileHash) throw new Error("读取期间文件已变化，请稍后重试");
  if (file.extension.toLowerCase() === "md") {
    const currentText = new TextDecoder().decode(await app.vault.readBinary(file));
    if (currentText !== draft.text) throw new Error("原文缓存与文件不一致，请重新打开文件后重试");
  }
  return { draft, fileHash };
}
export async function verifyEvidenceSource(app: App, source: PaperEvidence): Promise<void> {
  if (source.location_status !== "locatable") throw new Error("证据尚无唯一且有效的原文位置");
  const file = fileFor(app, source);
  if ((source.locator.kind === "pdf" ? "pdf" : "md") !== file.extension.toLowerCase()) throw new Error("原文文件类型已变化");
  const hash = await sha256(await app.vault.readBinary(file));
  let textHash: string | undefined;
  if (!source.snapshot?.file_sha256 && source.snapshot?.supplied_text_sha256) {
    const { draft, fileHash } = await prepareEvidenceBinding(app, source);
    if (fileHash !== hash) throw new Error("读取期间原文已变化");
    textHash = await sha256(new TextEncoder().encode(draft.text).buffer);
  }
  if (!matchesSnapshot(source, { file: hash, text: textHash })) throw new Error("当前文件与证据快照不一致，已停止定位。请核对原文版本");
}
