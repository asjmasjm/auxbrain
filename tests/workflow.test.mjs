import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const root = await mkdtemp(path.join(tmpdir(), "auxbrain-workflow-"));
const bundle = path.join(root, "workflow.cjs");
await build({
  stdin: { contents: `export { default as AuxBrainPlugin } from './src/main';
    export { AuxBrainView } from './src/view';
    export { readDocument } from './src/document-reader';
    export { isCompatibleCompanionVersion } from './src/api';
    export * from './tests/obsidian-mock';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", outfile: bundle,
  alias: { obsidian: path.resolve("tests/obsidian-mock.ts") }
});
const { AuxBrainPlugin, AuxBrainView, FileView, Setting, readDocument, isCompatibleCompanionVersion } = createRequire(import.meta.url)(bundle);
after(() => rm(root, { recursive: true, force: true }));
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.window = globalThis;

test("0.9.1 rejects old or malformed Companion versions", () => {
  for (const value of [undefined, null, "", "0.8.2", "0.8.4", "0.9.0", "bad", "0.9.1-beta"]) {
    assert.equal(isCompatibleCompanionVersion(value), false, String(value));
  }
  for (const value of ["0.9.1", "0.9.2", "0.10.0", "1.0.0"]) {
    assert.equal(isCompatibleCompanionVersion(value), true, value);
  }
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (name, extension = "md") => ({ path: `papers/${name}.${extension}`, basename: name, extension });
function config(configured = true) {
  return { llm: { providers: [
    { id: "deepseek", name: "DeepSeek", configured, default_model: "deepseek-v4-flash", models: [{ id: "deepseek-v4-flash", name: "DeepSeek" }] },
    { id: "volcengine-ark", name: "Volcengine", configured: false, default_model: "ark-code-latest", models: [{ id: "ark-code-latest", name: "Auto" }] }
  ] } };
}
function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

async function harness({ read = async (file) => `Text for ${file.basename}`, configured = true } = {}) {
  const events = new Map();
  const app = {
    openedModals: [], savedSettings: null,
    vault: { cachedRead: read },
    workspace: {
      currentFile: null, leaf: null,
      on(name, callback) { events.set(name, callback); return {}; },
      onLayoutReady(callback) { callback(); },
      getActiveFile() { return this.currentFile; },
      getLeavesOfType() { return this.leaf ? [this.leaf] : []; },
      revealLeaf() {}, rightSplit: { expand() {} },
      detachLeavesOfType() { this.leaf = null; }
    }
  };
  const plugin = new AuxBrainPlugin(app);
  const client = {
    configuration: async () => config(configured),
    questionHistory: async (sourcePath) => ({ questions: [{ question: sourcePath }], question_count: 1 })
  };
  plugin.client = () => client;
  await plugin.onload();
  const leaf = { app };
  const view = new AuxBrainView(leaf, plugin);
  leaf.view = view;
  app.workspace.leaf = leaf;
  view.render = () => {};
  const select = async (file, event = "file-open") => {
    app.workspace.currentFile = file;
    if (event === "active-leaf-change") {
      const reader = new FileView({ app });
      reader.file = file;
      events.get(event)({ view: reader });
    } else events.get(event)(file);
    await flush();
  };
  return { app, plugin, view, client, select, events };
}

test("first open without a key prompts once, and cancelled setup stays available", async () => {
  const { app, plugin, view } = await harness({ configured: false });
  await view.reloadConfiguration();
  assert.equal(app.openedModals.length, 1);
  assert.match(app.openedModals[0].contentEl.textContent, /首次使用/);
  app.openedModals[0].close();
  await view.reloadConfiguration();
  assert.equal(app.openedModals.length, 1);
  await plugin.openRuntimeConfiguration();
  assert.equal(app.openedModals.length, 2);
});

test("configured provider does not trigger onboarding", async () => {
  const { app, view } = await harness();
  await view.reloadConfiguration();
  assert.equal(app.openedModals.length, 0);
});

test("offline first use prompts only after the Companion reconnects", async () => {
  const { app, view, client } = await harness({ configured: false });
  client.configuration = async () => { throw new Error("offline"); };
  await view.reloadConfiguration();
  assert.match(view.configurationError, /offline/);
  assert.equal(app.openedModals.length, 0);
  client.configuration = async () => config(false);
  await view.reloadConfiguration();
  assert.equal(app.openedModals.length, 1);
});

test("concurrent settings requests do not create duplicate dialogs", async () => {
  const { app, plugin, client } = await harness();
  const pending = deferred();
  client.configuration = () => pending.promise;
  const first = plugin.openRuntimeConfiguration();
  await plugin.openRuntimeConfiguration();
  pending.resolve(config(false));
  await first;
  assert.equal(app.openedModals.length, 1);
});

test("selecting Volcengine and configuring a key saves the selected model first", async () => {
  const { app, plugin } = await harness({ configured: false });
  Setting.controls = [];
  await plugin.openRuntimeConfiguration();
  Setting.controls[1].change("volcengine-ark");
  const modal = app.openedModals[0];
  const key = descendants(modal.contentEl).find((element) => element.tag === "button" && element.textContent === "配置 Key");
  await key.onclick();
  await flush();
  assert.equal(app.savedSettings.llmProvider, "volcengine-ark");
  assert.equal(app.savedSettings.llmModel, "ark-code-latest");
  const keyModal = app.openedModals.at(-1);
  assert.match(keyModal.contentEl.textContent, /ark-code-latest/);
  const back = descendants(keyModal.contentEl).find((element) => element.options.attr?.["aria-label"] === "返回回答模式");
  back.onclick();
  await flush();
  assert.equal(app.openedModals.at(-1).provider, "volcengine-ark");
});

test("file-open and active-leaf-change refresh document context and history", async () => {
  const { view, select } = await harness();
  await select(file("A"));
  view.question = "Question A";
  view.understanding = { answer: "Answer A" };
  view.showEvidenceReasoning = true;
  view.showKnowledgeBase = true;
  view.interpretation = "Unsaved A";
  await select(file("B"), "active-leaf-change");
  assert.equal(view.draft.title, "B");
  assert.equal(view.question, "");
  assert.equal(view.understanding, null);
  assert.equal(view.interpretation, "");
  assert.equal(view.showEvidenceReasoning, false);
  assert.equal(view.showKnowledgeBase, false);
  assert.equal(view.questionHistory.questions[0].question, "papers/B.md");
});

test("focus returning from the panel to the same paper preserves question and HIL state", async () => {
  const { view, events, select } = await harness();
  await select(file("A"));
  view.setAnnotationDraft({ ...view.draft, text: "Selection A", sourceType: "selection" });
  view.interpretation = "My interpretation";
  events.get("active-leaf-change")({ view });
  events.get("file-open")(null);
  await select(file("A"), "active-leaf-change");
  assert.equal(view.intent, "annotate");
  assert.equal(view.interpretation, "My interpretation");
});

test("slow old document reads cannot replace the newer document", async () => {
  const pending = deferred();
  const { view, select } = await harness({ read: (file) => file.basename === "A" ? pending.promise : Promise.resolve("New B") });
  await select(file("A"));
  await select(file("B"));
  pending.resolve("Old A");
  await flush();
  assert.equal(view.draft.text, "New B");
});

test("refresh from the focused AuxBrain panel uses the last reader document", async () => {
  const { app, plugin, view, select } = await harness();
  await select(file("A"));
  app.workspace.currentFile = null;
  await plugin.loadActiveDocument();
  assert.equal(view.draft.sourcePath, "papers/A.md");
  assert.equal(view.draft.text, "Text for A");
});

test("switching back to the running task's paper cancels the pending switch", async () => {
  const { plugin, view, select } = await harness();
  await select(file("A"));
  view.understandingBusy = true;
  await select(file("B"));
  await select(file("A"));
  assert.equal(view.pendingDocumentTitle, "");
  view.understanding = { answer: "A completed" };
  view.understandingBusy = false;
  plugin.onWorkflowIdle();
  await flush();
  assert.equal(view.draft.title, "A");
  assert.equal(view.understanding.answer, "A completed");
});

test("obsolete read errors cannot overwrite the current paper", async () => {
  const pending = deferred();
  const { view, select } = await harness({ read: (file) => file.basename === "A" ? pending.promise : Promise.resolve("New B") });
  await select(file("A"));
  await select(file("B"));
  pending.reject(new Error("Old document error"));
  await flush();
  assert.equal(view.documentError, "");
  assert.equal(view.draft.title, "B");
});

test("failed new document load clears the old answer instead of leaving it actionable", async () => {
  const { view, select } = await harness({ read: async (file) => {
    if (file.basename === "B") throw new Error("Unreadable B");
    return "A text";
  } });
  await select(file("A"));
  view.understanding = { answer: "A answer" };
  await select(file("B"));
  assert.equal(view.draft.title, "B");
  assert.equal(view.understanding, null);
  assert.equal(view.documentError, "Unreadable B");
});

test("question history responses are discarded after document switches", async () => {
  const pending = deferred();
  const { view, client, select } = await harness();
  client.questionHistory = (path) => path.endsWith("A.md") ? pending.promise : Promise.resolve({ questions: ["B"] });
  await select(file("A"));
  await select(file("B"));
  pending.resolve({ questions: ["A"] });
  await flush();
  assert.deepEqual(view.questionHistory.questions, ["B"]);
});

for (const operation of ["answer", "write"]) {
  test(`switches during ${operation} finish on the original paper before loading the latest paper`, async () => {
    const { view, plugin, select } = await harness();
    await select(file("A"));
    const pending = deferred();
    plugin.ensureLlmCredential = async () => true;
    let source;
    plugin.askUnderstanding = (draft) => { source = draft.sourcePath; return pending.promise; };
    plugin.submitUnderstandingFeedback = (id) => { source = id; return pending.promise; };
    view.question = "Question A";
    view.understanding = { understanding_id: "answer-A" };
    const task = operation === "answer" ? view.runUnderstanding() : view.rateUnderstanding("up");
    await flush();
    await select(file("B"));
    await select(file("C"));
    assert.equal(view.draft.title, "A");
    assert.equal(view.pendingDocumentTitle, "C");
    assert.equal(source, operation === "answer" ? "papers/A.md" : "answer-A");
    pending.resolve(operation === "answer" ? { answer: "A result" } : { knowledge: { status: "stored", accepted: 1 } });
    await task;
    await flush();
    assert.equal(view.draft.title, "C");
    assert.equal(view.understanding, null);
    assert.equal(view.pendingDocumentTitle, "");
  });
}

test("document errors and results arriving after plugin unload are ignored", async () => {
  const pending = deferred();
  const { plugin, view, select } = await harness({ read: () => pending.promise });
  await select(file("A"));
  await plugin.onunload();
  pending.resolve("late A");
  await flush();
  assert.equal(view.draft.text, "");
});

test("aborted PDF reads stop between pages and release the PDF task", async () => {
  const abort = new AbortController();
  let pages = 0, destroyed = false;
  globalThis.__pdfjs = { getDocument: () => ({
    promise: Promise.resolve({ numPages: 3, getPage: async () => {
      pages += 1;
      return { getTextContent: async () => { abort.abort(); return { items: [{ str: "Page" }] }; }, cleanup() {} };
    } }), destroy: async () => { destroyed = true; }
  }) };
  const app = { vault: { readBinary: async () => new ArrayBuffer(1) } };
  await assert.rejects(readDocument(app, file("test", "pdf"), abort.signal), /取消/);
  assert.equal(pages, 1);
  assert.equal(destroyed, true);
});
