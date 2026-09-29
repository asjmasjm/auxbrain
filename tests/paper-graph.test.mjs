import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'auxbrain-graph-'));
const bundle=path.join(dir,'test.cjs');
await build({stdin:{contents:`export * from './src/paper-graph-client';export {paperProgress} from './src/paper-library-view';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:bundle,alias:{obsidian:path.resolve('tests/obsidian-mock.ts')}});
const {readPaperGraph,paperProgress}=createRequire(import.meta.url)(bundle);after(()=>rm(dir,{recursive:true,force:true}));
const fact=(id,p='paper-a')=>({assertion_id:id,paper_id:p,subject_type:'paper',subject_id:p,object_id:'data',canonical_name:'Dataset',relation_type:'trained_on',polarity:'asserted',evidence_text:'Source',dossier_review_status:'confirmed'});
test('paper progress uses recorded counts and never invents missing counts',()=>{
 assert.equal(paperProgress({counts:{questions:3,candidate:9}}),'已提问 3 次，9 条知识待入库确认');
 assert.equal(paperProgress({counts:{questions:null,candidate:null}}),'提问次数待同步，待确认知识数量待同步');
 assert.equal(paperProgress({counts:{questions:0,candidate:0}}),'已提问 0 次，0 条知识待入库确认');
});
test('paper graph requests only selected work, paginates and excludes withdrawn migrated facts',async()=>{
 const calls=[];const result=await readPaperGraph(async p=>{calls.push(p);const offset=calls.length===1?0:1;return {status:200,json:{offset,total:2,facts:[{...fact('a'+offset),dossier_review_status:offset?'retracted':'confirmed'}]}};},{paper_id:'work/a',title:'Same title'});
 assert.equal(calls.length,2);assert.ok(calls.every(p=>p.startsWith('/api/v1/dossiers/work%2Fa/facts?')));
 assert.equal(result.total,1);assert.equal(result.relations[0].paper_id,'paper-a');
});
test('empty paper graph never falls back to the entire personal graph',async()=>{
 let calls=0;const graph=await readPaperGraph(async()=>{calls++;return {status:200,json:{facts:[],total:0,offset:0}};},{paper_id:'empty',title:'Empty'});
 assert.equal(calls,1);assert.equal(graph.total,0);assert.equal(graph.entity_count,0);
 await assert.rejects(readPaperGraph(async()=>({status:404,json:{}}),{paper_id:'missing'}),/未显示其他论文/);
});
