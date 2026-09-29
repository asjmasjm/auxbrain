import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const dir=await mkdtemp(path.join(tmpdir(),'auxbrain-review-'));
const bundle=path.join(dir,'review.cjs');
await build({stdin:{contents:`export * from './src/dossier-review-client';export * from './src/paper-review-panel';export * from './src/paper-library-view';export * from './src/paper-library-client';export * from './src/paper-knowledge-presentation';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:bundle,alias:{obsidian:path.resolve('tests/obsidian-mock.ts')}});
const {DossierReviewClient,parseReviewItem,ReviewRequestError,PaperReviewPanel,PaperLibraryView,PaperLibraryClient,isSourceExcerpt,knowledgeLabel,sourcePreview,contributionGroups,scopeRows}=createRequire(import.meta.url)(bundle);
after(()=>rm(dir,{recursive:true,force:true}));
const raw=()=>({work_id:'work-a',item_id:'item-a',paper_id:'source-a',revision:2,effective_status:'candidate',review_origin:'',section:'method',statement:'A claim',kind:'paper_statement',scope:{stage:'training'},evidence:[{paper_id:'source-a',paragraph_id:'paragraph-a',quote:'Original evidence'}]});
const item=()=>parseReviewItem(raw(),'work-a');
const ok=json=>({status:200,json});

test('review snapshot retains revision/source/scope; rejects cross-paper and invalid revision',()=>{
  assert.equal(item().revision,2);assert.equal(item().evidence[0].quote,'Original evidence');
  for(const value of [{...raw(),revision:0},{...raw(),work_id:'other'},{...raw(),evidence:[{paper_id:'other',paragraph_id:'p',quote:'text'}]}]) assert.throws(()=>parseReviewItem(value,'work-a'));
});
test('explicit review preserves optimistic revision and human origin',async()=>{
  const calls=[];
  const client=new DossierReviewClient(async(p,b)=>{calls.push([p,b]);return ok({item:{...raw(),revision:3,effective_status:'confirmed',review_origin:'human'},replacement_id:null});});
  const result=await client.submit(item(),'confirm','reader','checked');
  assert.ok(calls[0][1].request_key);
  const {request_key,...body}=calls[0][1];
  assert.deepEqual(body,{revision:2,status:'confirmed',origin:'human',actor:'reader',note:'checked'});
  assert.equal(result.item.origin,'human');
});
test('correction preserves evidence and caller-supplied scope, never auto-confirms replacement',async()=>{
  const calls=[];
  const client=new DossierReviewClient(async(p,b)=>{calls.push([p,b]);return ok({item:{...raw(),revision:3,effective_status:'retracted'},replacement_id:'new-item'});});
  const result=await client.submit(item(),'correct','reader','',{statement:'Narrow claim',section:'method',kind:'paper_statement',scope:{stage:'finetuning'}});
  assert.equal(calls.length,1);assert.equal(result.replacementId,'new-item');
  assert.deepEqual(calls[0][1].replacement.evidence,item().evidence);
  assert.deepEqual(calls[0][1].replacement.scope,{stage:'finetuning'});
});
test('stale, retracted and empty/no-change corrections cannot write',async()=>{
  let calls=0;const client=new DossierReviewClient(async()=>{calls++;return ok({});});
  for(const status of ['stale','retracted']) await assert.rejects(client.submit({...item(),status},'confirm','reader',''));
  await assert.rejects(client.submit(item(),'correct','reader','',{statement:'',section:'method',kind:'paper_statement',scope:{}}));
  await assert.rejects(client.submit(item(),'correct','reader','',{statement:'A claim',section:'method',kind:'paper_statement',scope:{stage:'training'}}));
  assert.equal(calls,0);
});
test('409/network/malformed success require reconciliation without automatic retry',async()=>{
  for(const response of [{status:409,json:{}},{status:500,json:{}},ok({item:raw(),replacement_id:null}),null]) {
    let calls=0;const client=new DossierReviewClient(async()=>{calls++;if(!response)throw new Error('offline');return response;});
    await assert.rejects(client.submit(item(),'confirm','reader',''),error=>error instanceof ReviewRequestError&&error.mustReload);
    assert.equal(calls,1);
  }
});
test('item lookup paginates and history keeps numeric event identity',async()=>{
  const paths=[];const client=new DossierReviewClient(async p=>{paths.push(p);
    if(p.endsWith('/items/item-a'))return {status:404,json:{}};
    if(p.endsWith('/history'))return ok({events:[{event_id:2,work_id:'work-a',item_id:'item-a',kind:'confirmed',actor:'reader',created_at:'2026-09-28',detail:{revision:3}}]});
    return ok(p.endsWith('offset=0')?{items:[{item_id:'other'}],total:2,offset:0}:{items:[raw()],total:2,offset:1});});
  assert.equal((await client.item('work-a','item-a')).itemId,'item-a');
  assert.equal((await client.history('work-a','item-a'))[0].id,'2');assert.ok(paths[2].endsWith('offset=1'));
});
test('panel excludes double submit and ignores late results after close',async()=>{
  let finish,calls=0;
  const panel=new PaperReviewPanel({submit:()=>{calls++;return new Promise(r=>finish=r);}},item(),'reader',{back(){}});
  panel.edit('confirm');const pending=panel.submit();await panel.submit();assert.equal(calls,1);
  panel.dispose();finish({item:{...item(),revision:3},replacementId:null});await pending;
  assert.equal(panel.item.revision,2);
});
test('panel holds ambiguous write until readback and keeps correction draft',async()=>{
  let calls=0;const panel=new PaperReviewPanel({submit:async()=>{calls++;throw new ReviewRequestError('uncertain');},item:async()=>({...item(),revision:3,status:'confirmed'})},item(),'reader',{back(){}});
  panel.edit('correct');panel.statement='Narrow claim';await panel.submit();await panel.submit();
  assert.equal(calls,1);assert.equal(panel.statement,'Narrow claim');assert.equal(panel.needsReload,true);
  await panel.reload();assert.equal(panel.item.revision,3);assert.equal(panel.needsReload,false);
  assert.equal(panel.draftBackup.statement,'Narrow claim');
});
test('background refresh cannot erase an active card review',async()=>{
  let reads=0;const library=new PaperLibraryView({list:async()=>{reads++;}},{back(){},legacyGraph(){},evidence:async()=>{}});
  library.reviewPanel={};await library.refresh();assert.equal(reads,0);
});
test('non-dossier and legacy adapters never expose review writes',()=>{
  const client=new PaperLibraryClient('',async()=>ok({}));assert.equal(client.reviews,undefined);
});

test('excerpt presentation matches the entire quote, never invents a semantic summary',()=>{
  assert.equal(isSourceExcerpt('A  quoted\nstatement',['A quoted statement']),true);
  assert.equal(isSourceExcerpt('A claim',['A claim and a conflicting qualification']),false);
  assert.equal(isSourceExcerpt('', ['']),false);
});

test('distilling a long excerpt starts one empty draft without changing stored evidence',()=>{
  const quote='Original source evidence. '.repeat(30);
  const source={...item(),statement:quote,evidence:[{paragraph_id:'p',quote}]};
  const panel=new PaperReviewPanel({},source,'reader',{back(){}});
  panel.edit('correct');
  assert.equal(panel.statement,'');assert.equal(panel.item.statement,quote);
  assert.deepEqual(panel.item.evidence,source.evidence);
  panel.edit('confirm');assert.equal(panel.statement,quote);
});

test('editing a nonliteral knowledge statement retains the existing draft',()=>{
  const panel=new PaperReviewPanel({},item(),'reader',{back(){}});
  panel.edit('correct');assert.equal(panel.statement,'A claim');
});

test('source labels never claim a literal quote is a summary or a conclusion',()=>{
  assert.equal(knowledgeLabel(true,'candidate'),'待整理的原文');
  assert.equal(knowledgeLabel(true,'confirmed'),'保存的原文');
  assert.equal(knowledgeLabel(false,'candidate'),'知识结论');
  assert.equal(sourcePreview('A\n  B'),'A B');
  assert.equal(sourcePreview('x'.repeat(101)),'x'.repeat(100)+'...');
  assert.equal(sourcePreview('😀'.repeat(101)),'😀'.repeat(100)+'...');
});

test('even short excerpts start an empty interpretation and can open directly in writing mode',()=>{
  const source={...item(),statement:'Source sentence.',evidence:[{quote:'Source sentence.'}]};
  const panel=new PaperReviewPanel({},source,'reader',{back(){}},true);
  assert.equal(panel.mode,'correct');assert.equal(panel.statement,'');
  assert.equal(source.statement,'Source sentence.');
  for(const status of ['stale','retracted']) {
    const blocked=new PaperReviewPanel({},{...source,status},'reader',{back(){}},true);
    assert.equal(blocked.mode,'inspect');
  }
});

test('blank interpretation is a local validation error, not an uncertain database write',async()=>{
  let writes=0;
  const panel=new PaperReviewPanel({submit(){writes++;}},item(),'reader',{back(){}},true);
  panel.statement='  ';await panel.submit();
  assert.equal(writes,0);assert.equal(panel.needsReload,false);
  assert.equal(panel.error,'请填写你的理解后再保存');
});

test('contributions group distinct changes without leaking source paragraphs or item IDs',()=>{
  const change={kind:'added',section_key:'method',item_id:'private-id',summary:'Long original English paragraph. '.repeat(100)};
  assert.deepEqual(contributionGroups([change,change,{...change,item_id:'second'}, {...change,kind:'confirmed'}, {...change,section_key:null}]),[
    {kind:'added',section:'method',count:2},{kind:'confirmed',section:'method',count:1},{kind:'added',section:null,count:1}
  ]);
  assert.deepEqual(contributionGroups([]),[]);
});

test('conditions render as readable values and preserve false, zero and nested qualifiers',()=>{
  assert.deepEqual(scopeRows({}),[]);
  assert.deepEqual(scopeRows({answer_approval:'internal-answer-id',answer_part:1}),[]);
  assert.deepEqual(scopeRows({stage:'training',variant:0,conditions:{enabled:false,dataset:['A','B']}}),[
    {label:'阶段',value:'训练'},{label:'版本',value:'0'},{label:'条件',value:'是否启用：否；数据集：A、B'}
  ]);
});

test('a directly approved literal answer does not ask for another interpretation',()=>{
  const source={...item(),status:'confirmed',origin:'human',statement:'Source sentence.',scope:{answer_approval:'answer-id',answer_part:1},evidence:[{paragraph_id:'p',quote:'Source sentence.'}]};
  const panel=new PaperReviewPanel({},source,'reader',{back(){}});
  assert.equal(panel.isExcerpt(),false);
  panel.edit('correct');assert.equal(panel.statement,'Source sentence.');
});

test('saving an interpretation preserves structured scope and remains candidate until a separate confirmation',async()=>{
  const source={...item(),scope:{stage:'training',nested:{datasets:['A'],flag:false}}};
  const calls=[];
  const replacement={...source,itemId:'new-item',revision:1,statement:'My understanding',status:'candidate'};
  const panel=new PaperReviewPanel({submit:async(i,action,actor,note,draft)=>{
    calls.push({action,draft});return {item:{...i,status:action==='correct'?'retracted':'confirmed'},replacementId:action==='correct'?'new-item':null};
  },item:async()=>replacement},source,'reader',{back(){}},true);
  panel.statement='My understanding';await panel.submit();
  assert.equal(calls.length,1);assert.equal(calls[0].action,'correct');
  assert.deepEqual(calls[0].draft.scope,source.scope);assert.notEqual(calls[0].draft.scope,source.scope);
  assert.equal(panel.item.status,'candidate');assert.equal(panel.notice,'已保存为待确认知识，尚未纳入已确认知识');
  panel.edit('confirm');await panel.submit();
  assert.equal(calls[1].action,'confirm');assert.equal(panel.item.status,'confirmed');assert.equal(panel.notice,'已确认入库');
});
