import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'auxbrain-insights-'));
const bundle=path.join(dir,'test.cjs');
await build({stdin:{contents:`export * from './src/dossier-insights';export * from './src/paper-knowledge-search';export * from './src/paper-economics-panel';export * from './src/dossier-jobs';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:bundle,alias:{obsidian:path.resolve('tests/obsidian-mock.ts')}});
const {DossierInsightsClient,InsightsUnavailable,parseKnowledgeSearch,parseEconomics,PaperKnowledgeSearch,PaperEconomicsPanel,dossierJobLabel}=createRequire(import.meta.url)(bundle);
after(()=>rm(dir,{recursive:true,force:true}));
const hit=()=>({work_id:'w',paper_id:'p',title:'Paper',item:{work_id:'w',paper_id:'p',item_id:'i',revision:1,effective_status:'confirmed',kind:'paper_statement',section:'method',scope:{stage:'training'},statement:'Bridge is training data',evidence:[{paper_id:'p',paragraph_id:'para',quote:'Bridge is training data',section_title:'Method',location_status:'locatable',source_binding:{source_path:'test.pdf'},snapshot:{file_sha256:'a'.repeat(64)},locator:{kind:'pdf',page:2},location_label:'Page 2'}]}});
const result=()=>({version:'cross-card-discovery-v1',query:'Bridge',items:[hit()],total:55,related_work_count:2,limit:20,offset:0,creates_facts:false,provider_calls:0,connections:[{kind:'shared_query_term',term:'Bridge',work_ids:['w','w2']}]});
const costs=()=>({version:'dossier-economics-v1',work_id:'w',tracking_available:true,complete_billing_account:false,unknown_usage:[],known_tokens_by_stage:{answer:{input_tokens:4,output_tokens:6,total_tokens:10}},known_total_tokens:10,reused_build_jobs:3});
test('search preserves backend total, scope, work ID and existing evidence location semantics',()=>{
 const page=parseKnowledgeSearch(result(),'Bridge',0,20);
 assert.equal(page.total,55);assert.equal(page.items.length,1);assert.deepEqual(page.items[0].scope,{stage:'training'});
 assert.equal(page.items[0].workId,'w');assert.equal(page.items[0].evidence[0].locator.page,2);assert.equal(page.connections,undefined);
});
test('unconfirmed, inferred, cross-paper or invalid-location results are not displayed as knowledge',()=>{
 for(const change of [r=>r.items[0].item.effective_status='candidate',r=>r.items[0].item.kind='inference',r=>r.items[0].paper_id='other',r=>r.items[0].item.evidence[0].paper_id='other',r=>r.items[0].item.evidence[0].locator.page=0]){
  const r=result();change(r);assert.throws(()=>parseKnowledgeSearch(r,'Bridge',0,20));
 }
});
test('search uses GET, encoded submitted query and offset; blanks never reach backend',async()=>{
 const calls=[];const client=new DossierInsightsClient(async p=>{calls.push(p);return {status:200,json:{...result(),query:'Bridge & V2',offset:20}};});
 await client.search(' Bridge & V2 ',20);assert.equal(calls.length,1);assert.match(calls[0],/q=Bridge\+%26\+V2&limit=20&offset=20$/);
 await assert.rejects(client.search(' '));assert.equal(calls.length,1);
});
test('old backend disables only the unsupported feature; 500 is a retryable error',async()=>{
 for(const status of [404,501,500]) {
  const client=new DossierInsightsClient(async()=>({status,json:{}}));
  await assert.rejects(client.search('Bridge'),e=>(e instanceof InsightsUnavailable)===(status!==500));
 }
});
test('legacy knowledge route misparsed as work ID is unavailable, not all 400 errors',async()=>{
 const old=new DossierInsightsClient(async()=>({status:400,json:{error:'Unknown work_id'}}));
 await assert.rejects(old.search('Bridge'),InsightsUnavailable);
 await assert.rejects(old.economics('missing'),e=>!(e instanceof InsightsUnavailable));
 const invalid=new DossierInsightsClient(async()=>({status:400,json:{error:'Invalid query'}}));
 await assert.rejects(invalid.search('Bridge'),e=>!(e instanceof InsightsUnavailable));
});
test('knowledge search has no initial request, ignores typing, stale results and duplicate submits',async()=>{
 let calls=0,release;const panel=new PaperKnowledgeSearch(()=>{calls++;return new Promise(r=>release=r);},{open(){},evidence:async()=>{},availability(){}});
 panel.draft='Bridge';assert.equal(calls,0);
 const pending=panel.search('Bridge');await panel.search('Bridge');assert.equal(calls,1);
 panel.suspend();release(parseKnowledgeSearch(result(),'Bridge',0,20));await pending;assert.equal(panel.page,null);
});
test('search 404 stays disabled until explicit recheck',async()=>{
 let calls=0;const states=[];
 const panel=new PaperKnowledgeSearch(async()=>{calls++;throw new InsightsUnavailable();},{open(){},evidence:async()=>{},availability:v=>states.push(v)});
 await panel.search('Bridge');await panel.search('Bridge');assert.equal(calls,1);assert.equal(panel.unavailable,true);
 panel.resetAvailability();await panel.search('Bridge');assert.equal(calls,2);assert.deepEqual(states,[false,true,false]);
});
test('returning after card review refreshes the submitted query and original page',async()=>{
 const calls=[];const panel=new PaperKnowledgeSearch(async(q,offset)=>{calls.push([q,offset]);return {...parseKnowledgeSearch(result(),'Bridge',0,20),offset};},{open(){},evidence:async()=>{},availability(){}});
 panel.render=()=>{};panel.query='Bridge';panel.draft='unsubmitted edit';panel.page={offset:20};
 panel.invalidate();panel.mount({});await Promise.resolve();
 assert.deepEqual(calls,[['Bridge',20]]);assert.equal(panel.dirty,false);
 panel.mount({});assert.equal(calls.length,1);
});
test('usage is recorded tokens not complete billing; unavailable tracking is not zero cost',()=>{
 const r=parseEconomics(costs(),'w');assert.equal(r.total,10);assert.equal(r.complete,false);assert.equal(r.reused,3);
 const missing=parseEconomics({...costs(),tracking_available:false,unknown_usage:[{}]},'w');
 assert.equal(missing.trackingAvailable,false);assert.equal(missing.unknownCount,1);
 assert.throws(()=>parseEconomics({...costs(),work_id:'other'},'w'));
 assert.throws(()=>parseEconomics({...costs(),known_total_tokens:0},'w'));
});
test('usage is lazy, suppresses duplicate requests and ignores disposed paper results',async()=>{
 let calls=0,release;const panel=new PaperEconomicsPanel('w',()=>{calls++;return new Promise(r=>release=r);});
 assert.equal(panel.open,false);assert.equal(calls,0);
 const pending=panel.load();await panel.load();assert.equal(calls,1);
 panel.dispose();release(parseEconomics(costs(),'w'));await pending;assert.equal(panel.data,null);
});
test('usage 404 blocks automatic requests but permits explicit retry after update',async()=>{
 let calls=0;const panel=new PaperEconomicsPanel('w',async()=>{calls++;throw new InsightsUnavailable();});
 await panel.load();await panel.load();assert.equal(calls,1);assert.equal(panel.unavailable,true);
 await panel.load(true);assert.equal(calls,2);
});
test('only a completed reused_build receipt labels organization reuse',()=>{
 assert.equal(dossierJobLabel({state:'completed',receipt:{mode:'reused_build'}}),'已复用整理结果');
 assert.equal(dossierJobLabel({state:'completed'}),'知识整理完成');
 assert.equal(dossierJobLabel({state:'running',receipt:{mode:'reused_build'}}),'正在整理个人知识');
});
