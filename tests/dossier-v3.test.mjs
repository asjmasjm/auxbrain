import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const root = await mkdtemp(path.join(tmpdir(), 'auxbrain-v3-'));
const bundle = path.join(root, 'test.cjs');
await build({stdin:{contents:`export * from './src/paper-evidence-source'; export * from './src/paper-library-client'; export * from './src/dossier-review-client'; export * from './src/paper-library-view'; export { TFile } from 'obsidian';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:bundle,alias:{obsidian:path.resolve('tests/obsidian-mock.ts')}});
const {sha256,matchesSnapshot,verifyEvidenceSource,prepareEvidenceBinding,PaperLibraryClient,DossierReviewClient,PaperLibraryView,TFile}=createRequire(import.meta.url)(bundle);
after(()=>rm(root,{recursive:true,force:true}));
const ok=json=>({status:200,json});
const fixture=JSON.parse(await readFile(new URL('./fixtures/dossiers-v1.json',import.meta.url),'utf8'));
function wire(route, change=()=>{}) {
  const response=structuredClone(fixture.responses[route.replace(/&sort=[^&]+&order=[^&]+$/,'')]);
  change(response.json,route);return response;
}

test('v3 list sends server-side sort and preserves linked question count scope',async()=>{
  const client=new PaperLibraryClient('',async route=>wire(route,(data,p)=>{
    if(p.startsWith('/api/v1/dossiers?')){
      assert.match(p,/sort=title&order=asc$/);data.sort='title';data.order='asc';
      data.works.forEach(w=>{w.question_count=7;w.question_count_scope='dossier_linked';w.updated_at='2026-09-29T00:00:00Z';});
    }
  }));
  const page=await client.list('','title');assert.equal(page.sorting,true);
  assert.equal(page.papers[0].counts.questions,7);assert.equal(page.papers[0].question_count_scope,'dossier_linked');
});
test('v3 maps only unique current anchors; missing/changed/ambiguous never expose a locator',async()=>{
  for(const status of ['locatable','missing_location','source_changed','ambiguous']){
    const client=new PaperLibraryClient('',async route=>wire(route,(data,p)=>{
      if(p.includes('/items?'))for(const item of data.items)for(const e of item.evidence)Object.assign(e,{
        location_status:status,source_binding:{source_path:'papers/test.pdf'},snapshot:{file_sha256:'a'.repeat(64)},
        locator:{kind:'pdf',page:2},location_label:'Page 2'});
    }));
    await client.list('','updated');const paper=await client.detail(fixture.work_id);
    const e=paper.sections.flatMap(s=>s.items).flatMap(i=>i.evidence)[0];
    assert.equal(e.location_status,status);assert.equal(e.source_path,'papers/test.pdf');
    assert.equal(e.locator.page,status==='locatable'?2:undefined);
  }
});
test('snapshot comparison never substitutes server JSON hashes for local file/text hashes',async()=>{
  const file=await sha256(new TextEncoder().encode('source').buffer);
  assert.equal(matchesSnapshot({snapshot:{file_sha256:file}},{file}),true);
  assert.equal(matchesSnapshot({snapshot:{file_sha256:'a'.repeat(64),supplied_text_sha256:file}},{file,text:file}),false);
  assert.equal(matchesSnapshot({snapshot:{supplied_text_sha256:file}},{file:'b'.repeat(64),text:file}),true);
  assert.equal(matchesSnapshot({snapshot:{text_hash:file}},{file,text:file}),false);
});
function local(text='Source') {
  const file=Object.assign(new TFile(),{path:'test.md',basename:'Test',extension:'md'});
  const app={vault:{getAbstractFileByPath:p=>p===file.path?file:null,readBinary:async()=>new TextEncoder().encode(text).buffer,cachedRead:async()=>text}};
  return {app,file};
}
test('navigation checks actual bytes and refuses changed documents and path traversal',async()=>{
  const {app}=local();const hash=await sha256(await app.vault.readBinary());
  const source={source_path:'test.md',location_status:'locatable',locator:{kind:'markdown',line_start:1,line_end:1},snapshot:{file_sha256:hash}};
  await verifyEvidenceSource(app,source);
  await assert.rejects(verifyEvidenceSource(app,{...source,snapshot:{file_sha256:'0'.repeat(64)}}),/快照不一致/);
  for(const p of ['../test.md','C:/test.md','/test.md','a\\test.md'])await assert.rejects(verifyEvidenceSource(app,{...source,source_path:p}),/路径/);
  await assert.rejects(verifyEvidenceSource(app,{...source,location_status:'ambiguous'}),/唯一/);
});
test('text-only anchors verify extracted text and reject stale markdown cache',async()=>{
  const {app}=local('Source\n');const hash=await sha256(new TextEncoder().encode('Source\n').buffer);
  await verifyEvidenceSource(app,{source_path:'test.md',location_status:'locatable',locator:{kind:'markdown'},snapshot:{supplied_text_sha256:hash}});
  app.vault.cachedRead=async()=>'Old source';
  await assert.rejects(prepareEvidenceBinding(app,{source_path:'test.md'}),/缓存/);
});
test('binding uses current optimistic revision and preserves exact untrimmed text',async()=>{
  const calls=[];const client=new PaperLibraryClient('',async(p,b)=>{calls.push([p,b]);if(p.includes('?'))return wire(p);
    return ok({paper_id:'p',revision:b?3:2});});
  await client.list('','updated');await client.bindLocations('p',{text:' Source\n',sourcePath:'test.md',segments:[]},'a'.repeat(64));
  const body=calls.at(-1)[1];assert.equal(body.revision,2);assert.equal(body.text,' Source\n');assert.equal(body.snapshot.file_sha256,'a'.repeat(64));
});
test('legacy exact-snapshot backfill is allowed only for the explicit missing registration error',async()=>{
  for(const error of ['Unknown registered document','Invalid document']){
    let posts=0;const client=new PaperLibraryClient('',async(p,b)=>{
      if(p.includes('?'))return wire(p);if(b){posts++;return ok({paper_id:'p',revision:1});}
      return {status:400,json:{error}};
    });await client.list('','updated');
    const result=client.bindLocations('p',{text:'Source',sourcePath:'test.md',segments:[]},'a'.repeat(64));
    if(error==='Unknown registered document')await result;else await assert.rejects(result);
    assert.equal(posts,error==='Unknown registered document'?1:0);
  }
});
test('source binding is mutually exclusive, suppresses refresh and releases the host lock',async()=>{
  let release,writes=0;const locks=[];
  const library=new PaperLibraryView({detail:async()=>({paper_id:'w'})},{back(){},legacyGraph(){},evidence:async()=>{},reviewSession:a=>locks.push(a),bindEvidence:()=>{writes++;return new Promise(r=>release=r);}});
  const pending=library.bindEvidence({paper_id:'w'},{});await library.bindEvidence({paper_id:'w'},{});await library.refresh();
  assert.equal(writes,1);assert.equal(library.binding,true);release();await pending;
  assert.equal(library.binding,false);assert.deepEqual(locks,[true,false]);
});
test('single-item GET does not silently fall back on a server failure',async()=>{
  let calls=0;const client=new DossierReviewClient(async()=>{calls++;return {status:500,json:{}};});
  await assert.rejects(client.item('w','i'),/500/);assert.equal(calls,1);
});

const bindingSource=()=>({evidence_id:'i:p:0',source_paper_id:'p',text:'Original evidence',source_path:'test.pdf',location_status:'missing_location',locator:{},location_label:''});
const bindingPaper=(source)=>({paper_id:'w',sections:[{key:'method',items:source?[{item_id:'i',evidence:[source]}]:[]} ]});
function bindingHarness(detail,extra={}) {
  let writes=0;const notices=[],locks=[];
  const library=new PaperLibraryView({detail,...extra},{back(){},legacyGraph(){},evidence:async()=>{},
    bindEvidence:async()=>{writes++;},notify:m=>notices.push(m),reviewSession:a=>locks.push(a)});
  return {library,notices,locks,writes:()=>writes};
}

test('binding reports success only after this exact evidence is uniquely locatable',async()=>{
  const source=bindingSource(),located={...source,location_status:'locatable',locator:{kind:'pdf',page:2},location_label:'Page 2'};
  const h=bindingHarness(async()=>bindingPaper(located));
  await h.library.bindEvidence({paper_id:'w'},source);
  assert.equal(h.library.bindingFeedback.kind,'success');assert.equal(h.library.bindingFeedback.located,located);
  assert.match(h.notices[0],/本地原文关联成功/);assert.equal(h.writes(),1);
  assert.equal(h.library.expanded.has('method'),true);assert.equal(h.library.expandedEvidence.has('i'),true);
  assert.deepEqual(h.locks,[true,false]);
});

test('missing, ambiguous, changed or different evidence never produces binding success',async()=>{
  for(const status of ['missing_location','ambiguous','source_changed','locatable','other-evidence']) {
    const source=bindingSource(),returned={...source,location_status:status};
    if(status==='other-evidence')Object.assign(returned,{evidence_id:'other',location_status:'locatable',locator:{kind:'pdf',page:2}});
    const h=bindingHarness(async()=>bindingPaper(returned));
    await h.library.bindEvidence({paper_id:'w'},source);
    assert.equal(h.library.bindingFeedback.kind,'warning');assert.equal(h.library.bindingFeedback.located,undefined);
    assert.match(h.notices[0],/尚未定位/);
  }
});

test('binding readback loads later pages to verify the clicked evidence',async()=>{
  const source=bindingSource(),located={...source,location_status:'locatable',locator:{kind:'pdf',page:2}};
  let pages=0;
  const h=bindingHarness(async()=>({...bindingPaper(null),items_page:{loaded:0,total:1,next_cursor:'100'}}),{
    items:async(id,cursor)=>{assert.equal(id,'w');assert.equal(cursor,'100');pages++;return {...bindingPaper(located),total:1,next_cursor:null};}
  });
  await h.library.bindEvidence({paper_id:'w'},source);
  assert.equal(pages,1);assert.equal(h.library.bindingFeedback.kind,'success');
});

test('failed readback is not successful binding; recheck never repeats the write',async()=>{
  const source=bindingSource();let fail=true;
  const h=bindingHarness(async()=>{if(fail)throw new Error('offline');return bindingPaper({...source,location_status:'locatable',locator:{kind:'pdf',page:2}});});
  await h.library.bindEvidence({paper_id:'w'},source);
  assert.equal(h.library.bindingFeedback.title,'关联已保存，但结果核对失败');assert.equal(h.writes(),1);
  fail=false;await h.library.bindEvidence({paper_id:'w'},source,true);
  assert.equal(h.writes(),1);assert.equal(h.library.bindingFeedback.kind,'success');
});

test('write errors release locks and notify without reporting success',async()=>{
  const h=bindingHarness(async()=>{throw new Error('should not read');});
  h.library.callbacks.bindEvidence=async()=>{throw new Error('文件已变化');};
  await h.library.bindEvidence({paper_id:'w'},bindingSource());
  assert.equal(h.library.bindingFeedback.kind,'error');assert.match(h.notices[0],/文件已变化/);
  assert.equal(h.library.binding,false);assert.deepEqual(h.locks,[true,false]);
});

test('closing during binding discards late feedback and releases the lock once',async()=>{
  let release;const h=bindingHarness(async()=>bindingPaper(bindingSource()));
  h.library.callbacks.bindEvidence=()=>new Promise(r=>release=r);
  const pending=h.library.bindEvidence({paper_id:'w'},bindingSource());
  h.library.dispose();release();await pending;
  assert.equal(h.library.bindingFeedback,null);assert.deepEqual(h.notices,[]);assert.deepEqual(h.locks,[true,false]);
});

test('stalled pagination warns instead of looping or claiming a location',async()=>{
  const h=bindingHarness(async()=>({...bindingPaper(null),items_page:{loaded:0,total:1,next_cursor:'100'}}),{
    items:async()=>({...bindingPaper(null),total:1,next_cursor:'100'})
  });
  await h.library.bindEvidence({paper_id:'w'},bindingSource());
  assert.equal(h.library.bindingFeedback.kind,'error');assert.match(h.library.bindingFeedback.detail,/分页未前进/);
});
