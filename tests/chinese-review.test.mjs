import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
const dir=await mkdtemp(path.join(tmpdir(),'auxbrain-chinese-')),bundle=path.join(dir,'test.cjs');
await build({stdin:{contents:`export * from './src/knowledge-relation';export * from './src/answer-knowledge-panel';export * from './src/paper-review-panel';export * from './src/paper-library-client';export * from './src/paper-knowledge-presentation';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:bundle,alias:{obsidian:path.resolve('tests/obsidian-mock.ts')}});
const {knowledgeRelation,correctedScope,importedRelationStatement,answerRelations,PaperReviewPanel,PaperLibraryClient,scopeRows}=createRequire(import.meta.url)(bundle);
after(()=>rm(dir,{recursive:true,force:true}));
const scope={subject:'OrthoSkillVLA',relation:'evaluated_on',object:'LIBERO',polarity:'asserted',stage:'evaluation'};
const item={workId:'work-a',itemId:'item-a',paperId:'paper-a',status:'candidate',origin:'',revision:1,section:'results',kind:'paper_statement',statement:'A result',scope,evidence:[{paragraph_id:'p',quote:'Original paper evidence.'}]};
test('only explicit supported relations render; no edge inferred from keywords or prose',()=>{
  assert.equal(knowledgeRelation(scope).object,'LIBERO');
  for(const s of [{},{subject:'A',object:'B'}, {...scope,relation:'unknown_relation'},{...scope,polarity:'unknown'},{...scope,object:{name:'B'}},{...scope,subject:''}]) assert.equal(knowledgeRelation(s),null);
  assert.equal(importedRelationStatement('OrthoSkillVLA: evaluated_on LIBERO (asserted).',scope),true);
  assert.equal(importedRelationStatement('A different conclusion',scope),false);
});
test('technical scope menus are Chinese while proper entity names and qualifiers remain exact',()=>{
  assert.deepEqual(scopeRows(scope),[{label:'关系主体',value:'OrthoSkillVLA'},{label:'关系',value:'在数据集/基准上评估'},{label:'关联实体',value:'LIBERO'},{label:'肯否判断',value:'肯定'},{label:'阶段',value:'评测'}]);
  assert.equal(scopeRows({internal_unknown:'A'})[0].label,'其他条件');
  assert.equal(scopeRows({subject:'training'})[0].value,'training');
});
test('free-text correction invalidates the old edge and approval, preserving other conditions',()=>{
  const original={...scope,answer_approval:'saved-id',answer_part:1,conditions:{enabled:false}};
  assert.deepEqual(correctedScope(original,true),{stage:'evaluation',conditions:{enabled:false}});
  assert.deepEqual(correctedScope(original,false),original);assert.ok(original.relation);
});
test('editing an imported relation presents Chinese without rewriting the saved original',()=>{
  const original={...item,statement:'OrthoSkillVLA: evaluated_on LIBERO (asserted).'};
  const panel=new PaperReviewPanel({},original,'reader',{back(){}});panel.edit('correct');
  assert.equal(panel.statement,'OrthoSkillVLA：肯定，在数据集/基准上评估 LIBERO。');
  assert.equal(panel.item.statement,original.statement);
});
test('review agreement is one request, no duplicate while pending, and no second confirmation',async()=>{
  let finish,calls=0;const panel=new PaperReviewPanel({submit:async()=>{calls++;return new Promise(r=>finish=r);}},item,'reader',{back(){}});
  const pending=panel.agree();await panel.agree();assert.equal(calls,1);
  finish({item:{...item,status:'confirmed',origin:'human',revision:2},replacementId:null});await pending;
  assert.equal(panel.mode,'inspect');assert.equal(panel.item.status,'confirmed');await panel.agree();assert.equal(calls,1);
});
test('excerpts and invalidated knowledge cannot be directly agreed',async()=>{
  let calls=0;const client={submit(){calls++;}};
  for(const candidate of [{...item,statement:item.evidence[0].quote},{...item,status:'stale'},{...item,status:'retracted'}]) await new PaperReviewPanel(client,candidate,'reader',{back(){}}).agree();
  assert.equal(calls,0);
});
test('answer relations follow source understanding ID over all pages, dedupe and omit stale edges',async()=>{
  const paths=[],ids=[];
  const source={contributions:async(work,cursor)=>{paths.push([work,cursor]);return cursor==='0'?{contributions:[{source_understanding_id:'different',changes:[{item_id:'unrelated'}]}],next_cursor:'20'}:{contributions:[{source_understanding_id:'answer-a',changes:[{item_id:'item-a'},{item_id:'item-a'},{item_id:'old'}]}],next_cursor:null};},reviews:{item:async(work,id)=>{ids.push(id);return {...item,itemId:id,status:id==='old'?'stale':'candidate'};}}};
  assert.equal((await answerRelations(source,'work-a','answer-a')).length,1);
  assert.deepEqual(ids,['item-a','old']);assert.deepEqual(paths,[['work-a','0'],['work-a','20']]);
});
test('failed pagination and cross-paper item results are errors, never empty success',async()=>{
  const source={contributions:async()=>({contributions:[{source_understanding_id:'a',changes:[{item_id:'item-a'}]}],next_cursor:null}),reviews:{item:async()=>({...item,workId:'other'})}};
  await assert.rejects(answerRelations(source,'work-a','a'),/所属论文/);
  source.contributions=async()=>({contributions:[],next_cursor:'0'});
  await assert.rejects(answerRelations(source,'work-a','a'),/分页异常/);
});
test('answer relation reads use dossier API without visiting library first',async()=>{
  const paths=[];const client=new PaperLibraryClient('http://127.0.0.1:8795',async path=>{paths.push(path);return {status:200,json:{questions:[{question_id:'q',source_question_id:'a',question:'Q',created_at:'2026-09-29',events:[],job:null}],total:1,offset:0,limit:20}};});
  assert.deepEqual(await answerRelations(client.answerKnowledgeSource(),'work-a','a'),[]);
  assert.deepEqual(paths,['/api/v1/dossiers/work-a/contributions?limit=20&offset=0']);
});
