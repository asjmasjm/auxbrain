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
const { AuxBrainPlugin, AuxBrainView, Element, FileView, TFile, Menu, Setting, readDocument, isCompatibleCompanionVersion } = createRequire(import.meta.url)(bundle);
after(() => rm(root, { recursive: true, force: true }));
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.window = globalThis;

test("0.11.2 rejects old or malformed Companion versions", () => {
  for (const value of [undefined, null, "", "0.8.2", "0.9.1", "0.10.0", "0.11.1", "bad", "0.11.2-beta"]) {
    assert.equal(isCompatibleCompanionVersion(value), false, String(value));
  }
  for (const value of ["0.11.2", "0.11.3", "0.12.0", "1.0.0"]) {
    assert.equal(isCompatibleCompanionVersion(value), true, value);
  }
});

test("approval is one request, excludes correction while pending and is disabled on old servers",async()=>{
  const {view,client,select}=await harness();await select(file('approval'));
  const answer={understanding_id:'answer-one',answer:'Correct answer',evidence:[{text:'Source',cited:true}]};
  view.understanding=answer;let calls=0;const pending=deferred();
  client.approveAnswer=()=>{calls++;return pending.promise;};
  await view.approveUnderstanding();assert.equal(calls,0);
  view.bridgeConfig={answer_approval_version:1};
  const task=view.approveUnderstanding();await view.approveUnderstanding();view.startAnswerCorrection();
  assert.equal(calls,1);assert.equal(view.correctionEvidence,null);assert.equal(view.feedbackBusy,true);
  pending.resolve({understanding_id:answer.understanding_id,work_id:'work',item_ids:['item'],status:'confirmed'});
  await task;await view.approveUnderstanding();assert.equal(calls,1);assert.equal(view.feedbackBusy,false);
});

test("uncertain approval retry keeps its key and successful receipt restores navigation",async()=>{
  const {view,client,select}=await harness();await select(file('retry'));
  view.bridgeConfig={answer_approval_version:1};view.understanding={understanding_id:'answer-one',answer:'Answer',evidence:[{text:'Source',cited:true}]};
  const keys=[];client.approveAnswer=async(id,answer,actor,key)=>{keys.push(key);if(keys.length===1)throw new Error('Network interrupted');return {status:'confirmed',work_id:'work',item_ids:['item']};};
  await view.approveUnderstanding();view.startAnswerCorrection();assert.equal(view.correctionEvidence,null);assert.equal(view.approvalNeedsCheck,true);
  await view.approveUnderstanding();assert.equal(keys[0],keys[1]);assert.equal(view.approvalNeedsCheck,false);
  await select(file('new'));assert.equal(view.approvalKey,'');assert.equal(view.approvedAnswer,null);
});

test("correction prefills the answer and retains all cited sources without rating or saving",async()=>{
  const {view,client,select}=await harness();await select(file('correction'));
  let writes=0;client.approveAnswer=()=>{writes++;};
  view.understanding={understanding_id:'answer',answer:'Edit only the wrong part',evidence:[],evidence_candidates:[{text:'Source A',cited:true},{text:'Source B',cited:true},{text:'Uncited',cited:false}]};
  view.startAnswerCorrection();assert.equal(view.interpretation,'Edit only the wrong part');assert.equal(view.correctionEvidence.text,'Source A\n\nSource B');assert.equal(writes,0);
  view.exitCorrection();assert.equal(view.understanding.answer,'Edit only the wrong part');assert.equal(view.approvedAnswer,null);
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
      iterateAllLeaves() {},
      getActiveFile() { return this.currentFile; },
      getMostRecentLeaf() { return this.recentLeaf ?? null; },
      getLeavesOfType() { return this.leaf ? [this.leaf] : []; },
      revealLeaf() {}, rightSplit: { expand() {}, collapsed: false, containerEl: { contains: () => true } },
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

test("document load menu appears only for an unloaded supported document and permits retry after a read error", async () => {
  const {plugin,view,app}=await harness();const paper=file('menu','pdf');app.workspace.currentFile=paper;
  let menu=new Menu();assert.equal(plugin.addDocumentQuestionMenuItem(menu),true);
  assert.equal(menu.items[0].title,'为当前文档载入AuxBrain');
  view.setUnderstandingDraft({text:'Paper text',sourcePath:paper.path,title:paper.basename,sourceType:'pdf'});
  assert.equal(plugin.addDocumentQuestionMenuItem(new Menu()),false);
  view.beginDocumentLoad({text:'',sourcePath:paper.path,title:paper.basename,sourceType:'pdf'});
  assert.equal(plugin.addDocumentQuestionMenuItem(new Menu()),false);
  view.setDocumentError('read failed');assert.equal(plugin.addDocumentQuestionMenuItem(new Menu()),true);
  view.feedbackBusy=true;assert.equal(plugin.addDocumentQuestionMenuItem(new Menu()),false);view.feedbackBusy=false;
  assert.equal(plugin.addDocumentQuestionMenuItem(new Menu(),file('image','png')),false);
  let loaded;plugin.openCurrentDocumentQuestion=async f=>{loaded=f;};
  app.workspace.currentFile=file('other');await menu.items[0].click();assert.equal(loaded.path,paper.path);
});

test("PDF and blank panel context menus avoid empty interception and retain selected-text annotation", async () => {
  const previousElement=globalThis.HTMLElement,previousSelection=window.getSelection,previousAdd=document.addEventListener;
  let handler,type='pdf',selection='',prevented=0;
  globalThis.HTMLElement=class { closest(selector){return selector==='.workspace-leaf-content'?{getAttribute:()=>type}:null;} };
  document.addEventListener=(name,fn)=>{if(name==='contextmenu')handler=fn;};window.getSelection=()=>({toString:()=>selection});
  try {
    const {plugin,view,app}=await harness();const paper=file('context','pdf');app.workspace.currentFile=paper;
    // No containing native FileView in this test; use the active reader fallback.
    const getLeaves=app.workspace.getLeavesOfType;app.workspace.getLeavesOfType=function(t){return t==='pdf'||t==='markdown'?[]:getLeaves.call(this);};
    view.containerEl.contains=()=>false;
    const event={target:new HTMLElement(),preventDefault(){prevented++;},stopImmediatePropagation(){}};Menu.shown=[];
    handler(event);assert.equal(Menu.shown.at(-1).items[0].title,'为当前文档载入AuxBrain');
    view.setUnderstandingDraft({text:'Loaded',sourcePath:paper.path,title:'Context',sourceType:'pdf'});
    handler(event);assert.equal(prevented,1);
    selection='Selected passage';handler(event);assert.equal(Menu.shown.at(-1).items.length,1);assert.equal(Menu.shown.at(-1).items[0].title,'加入 AuxBrain');
    view.draft=null;selection='';type='fkms-obsidian-ui-view';handler(event);assert.equal(prevented,3);
    type='file-explorer';handler(event);assert.equal(prevented,3);
  } finally {globalThis.HTMLElement=previousElement;window.getSelection=previousSelection;document.addEventListener=previousAdd;}
});

test("hidden or collapsed loaded panels remain reachable without reloading their answers", async () => {
  const {plugin,view,app}=await harness();const paper=file('hidden','pdf');app.workspace.currentFile=paper;
  view.setUnderstandingDraft({text:'Keep this source',sourcePath:paper.path,title:'Hidden',sourceType:'pdf'});
  const original=view.draft;view.containerEl.visible=false;
  let revealed=0;plugin.activateView=async()=>{revealed++;};plugin.openCurrentDocumentQuestion=async()=>{throw Error('Must not reload');};
  const menu=new Menu();assert.equal(plugin.addDocumentQuestionMenuItem(menu),true);
  assert.equal(menu.items[0].title,'打开当前文档的 AuxBrain');await menu.items[0].click();
  assert.equal(revealed,1);assert.equal(view.draft,original);
  view.containerEl.visible=true;view.containerEl.closest=()=>({});app.workspace.rightSplit.collapsed=true;
  assert.equal(plugin.addDocumentQuestionMenuItem(new Menu()),true);
  app.workspace.rightSplit.collapsed=false;assert.equal(plugin.addDocumentQuestionMenuItem(new Menu()),false);
});

test("cold sidebar focus resolves the most recent reader without an active file", async () => {
  const {plugin,app}=await harness();const reader=new FileView({app});reader.file=file('recent','pdf');
  app.workspace.currentFile=null;plugin.activeDocument=null;app.workspace.recentLeaf={view:reader};
  const menu=new Menu();assert.equal(plugin.addDocumentQuestionMenuItem(menu),true);
  let loaded;plugin.openCurrentDocumentQuestion=async f=>{loaded=f;};await menu.items[0].click();
  assert.equal(loaded.path,reader.file.path);
});

test("native file menu uses the clicked file and never accepts a folder", async () => {
  const {plugin,app,events}=await harness();const selected=Object.assign(new TFile(),file('clicked','pdf'));
  app.workspace.currentFile=file('different');const menu=new Menu();events.get('file-menu')(menu,selected,'file-explorer');
  let loaded;plugin.openCurrentDocumentQuestion=async f=>{loaded=f;};await menu.items[0].click();
  assert.equal(loaded,selected);const folderMenu=new Menu();events.get('file-menu')(folderMenu,{path:'folder'},'file-explorer');assert.equal(folderMenu.items.length,0);
});

function contextEvent({type='outline',side=true,editable=false,doc,contentContains=()=>true}={}) {
  const content=type?{getAttribute:()=>type,contains:contentContains}:null;
  const target={ownerDocument:doc,closest(selector){
    if(selector==='.workspace-leaf-content')return content;
    if(selector==='.workspace-split.mod-right-split')return side?{}:null;
    if(selector.startsWith('textarea'))return editable?{}:null;
    return null;
  }};
  return {target,prevented:false,stopped:false,composedPath:()=>[target],preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
}

test('late graph responses never replace another paper graph or a newly opened document',async()=>{
 const {view}=await harness();view.showLegacyKnowledge=true;
 const old=deferred(),latest=deferred();view.knowledgeReader=()=>old.promise;
 const a=view.loadPersonalKnowledge();view.knowledgeReader=()=>latest.promise;const b=view.loadPersonalKnowledge();
 latest.resolve({relations:[],total:0,entity_count:0});await b;
 old.resolve({relations:[{paper_title:'Wrong paper'}],total:1,entity_count:2});await a;
 assert.equal(view.knowledge.total,0);
 const pending=deferred();view.knowledgeReader=()=>pending.promise;const c=view.loadPersonalKnowledge();
 view.resetDraft({text:'New paper',sourcePath:'new.pdf',title:'New',sourceType:'pdf'});
 pending.resolve({relations:[{}],total:1,entity_count:2});await c;assert.equal(view.knowledge,null);
});
test('same-title papers with different source identities remain separate graph groups',async()=>{
 const {view}=await harness();
 assert.equal(view.groupKnowledgeByPaper([{paper_id:'a',paper_title:'Same'},{paper_id:'b',paper_title:'Same'}]).size,2);
 assert.equal(view.groupKnowledgeByPaper([{source_uri:'obsidian://a.pdf',paper_title:'Same'},{source_uri:'obsidian://b.pdf',paper_title:'Same'}]).size,2);
});

test("right outline and empty dock offer entry while unrelated areas and input menus remain native", async () => {
  const {plugin,app}=await harness();app.workspace.currentFile=file('entry','pdf');
  for(const type of ['outline','empty','']) {const event=contextEvent({type});plugin.handleContextMenu(event);assert.equal(event.prevented,true);}
  for(const options of [{type:'file-explorer'},{type:'outline',side:false},{editable:true},{type:'settings'}]) {
    const event=contextEvent(options);plugin.handleContextMenu(event);assert.equal(event.prevented,false);
  }
});

test("cross-realm targets capture only their own reader selection, never a later or stale selection", async () => {
  const {plugin,view,app}=await harness();app.workspace.currentFile=file('selected','pdf');view.containerEl.contains=()=>false;
  const doc={defaultView:{getSelection:()=>({anchorNode:{},toString:()=> 'Original selected passage'})}};
  const event=contextEvent({type:'pdf',doc});Menu.shown=[];plugin.handleContextMenu(event);
  const menu=Menu.shown.at(-1);let text;plugin.handleSelectionAction=async getText=>{text=await getText();};
  doc.defaultView.getSelection=()=>({toString:()=> 'Unrelated later selection'});
  await menu.items.find(item=>item.title==='加入 AuxBrain').click();assert.equal(text,'Original selected passage');
  doc.defaultView.getSelection=()=>({anchorNode:{},toString:()=> 'Other tab selection'});
  plugin.handleContextMenu(contextEvent({type:'pdf',doc,contentContains:()=>false}));
  assert.equal(Menu.shown.at(-1).items.some(item=>item.title==='加入 AuxBrain'),false);
});

test("pop-out documents register once and release context handlers on unload", async () => {
  const {plugin,events}=await harness();let added=0,removed=0,handler;const cleanup=[];
  plugin.register=fn=>cleanup.push(fn);
  const doc={addEventListener(_name,fn){added++;handler=fn;},removeEventListener(){removed++;}};
  events.get('window-open')({}, {document:doc});events.get('window-open')({}, {document:doc});assert.equal(added,1);
  cleanup.forEach(fn=>fn());assert.equal(removed,1);
  plugin.unloaded=true;const event=contextEvent();handler(event);assert.equal(event.prevented,false);
});

test("menu display failure leaves native context event unconsumed", async () => {
  const {plugin,app}=await harness();app.workspace.currentFile=file('failure','pdf');
  const show=Menu.prototype.showAtMouseEvent;Menu.prototype.showAtMouseEvent=()=>{throw Error('menu unavailable');};
  try {const event=contextEvent();plugin.handleContextMenu(event);assert.equal(event.prevented,false);assert.equal(event.stopped,false);}
  finally {Menu.prototype.showAtMouseEvent=show;}
});

test("collaboration progress hides selection children but retains total time and raw telemetry", async () => {
  const {view,plugin}=await harness();
  const stages=[{id:'evidence_selection',label:'Selection',status:'running',elapsed_ms:3000,children:[
    {id:'selection_1_waiting',label:'Round 1 waiting',status:'completed',elapsed_ms:1000},
    {id:'selection_1_first',label:'Round 1 first result',status:'running',elapsed_ms:2000}]}];
  const rows=view.progressRows(stages);
  assert.equal(rows.length,1);assert.equal(rows[0].detail,false);
  assert.equal(rows[0].label,'AuxBrain+LLM协同');assert.equal(rows[0].elapsed_ms,3000);
  assert.equal(stages[0].children[1].elapsed_ms,2000);assert.equal(stages[0].label,'Selection');
  plugin.settings.analysisMode='llm';assert.ok(!view.pendingUnderstandingJob().stages.some(s=>s.id==='evidence_selection'));
  plugin.settings.analysisMode='hybrid';assert.equal(view.pendingUnderstandingJob().stages.find(s=>s.id==='evidence_selection').label,'AuxBrain+LLM协同');
  const root=new Element();view.renderUnderstandingProgress(root,{status:'running',elapsed_ms:3000,stages});
  assert.equal(descendants(root).filter(n=>n.options?.attr?.['data-stage-id']).length,1);
  const other=view.progressRows([{...stages[0],id:'knowledge_write'}]);
  assert.equal(other.length,3);assert.equal(other[1].detail,true);
});

test("card review session locks document replacement until returning to the paper", async () => {
  const {view,plugin,select}=await harness();
  await select(file("original"));
  const library=view.library();
  library.callbacks.reviewSession(true);
  assert.equal(view.isWorkflowBusy(),true);
  await select(file("next"));
  assert.equal(view.documentPath,file("original").path);
  library.callbacks.reviewSession(false);
  await flush();await flush();
  assert.equal(view.documentPath,file("next").path);
  assert.equal(view.isWorkflowBusy(),false);
});

test("paper library owns a child mount and preserves the AuxBrain header", async () => {
  const { view } = await harness();
  const container = new Element();
  const header = container.createDiv({ text: "AuxBrain" });
  let mounted;
  view.library = () => ({ mount(node) { mounted = node; node.empty(); } });
  view.renderPersonalKnowledge(container);
  assert.notEqual(mounted, container);
  assert.equal(container.children[0], header);
  assert.equal(container.children[1], mounted);
  assert.equal(mounted.options.cls, "ab-library-mount");
  assert.equal(header.textContent, "AuxBrain");
});

test("failed question retries reuse identity but new successful questions get new keys", async () => {
  const { view, plugin, select } = await harness();
  await select(file("A"));
  view.question = "Which dataset?";
  plugin.ensureLlmCredential = async () => true;
  const keys = [];
  plugin.askUnderstanding = async (_draft, _question, _n, _progress, key) => {
    keys.push(key);
    if (keys.length === 1) throw new Error("lost response");
    return { answer: "test" };
  };
  await view.runUnderstanding();
  await view.runUnderstanding();
  await view.runUnderstanding();
  assert.ok(keys[0]); assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
});

test("background updates do not rerender the question input or block asking", async () => {
  const { view } = await harness();
  let renders = 0;
  view.render = () => { renders++; };
  view.dossierTracker.start({ job_id: "done", state: "completed" });
  assert.equal(renders, 0);
  assert.equal(view.isWorkflowBusy(), false);
  await view.onClose();
});

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
  const key = descendants(modal.contentEl).find((element) => element.tag === "button" && element.textContent === "配置密钥");
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
    const { view, plugin, client, select } = await harness();
    await select(file("A"));
    const pending = deferred();
    plugin.ensureLlmCredential = async () => true;
    let source;
    plugin.askUnderstanding = (draft) => { source = draft.sourcePath; return pending.promise; };
    client.approveAnswer = (id) => { source = id; return pending.promise; };
    view.bridgeConfig = {answer_approval_version:1};
    view.question = "Question A";
    view.understanding = { understanding_id: "answer-A" };
    const task = operation === "answer" ? view.runUnderstanding() : view.approveUnderstanding();
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
