import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const root=await mkdtemp(path.join(tmpdir(),'auxbrain-provider-'));
const bundle=path.join(root,'provider.cjs');
await build({stdin:{contents:`export * from './src/llm-config-modal'; export * from './src/runtime-config-modal'; export * from './src/provider-notice'; export * from './src/errors'; export * from './tests/obsidian-mock';`,resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',outfile:bundle,alias:{obsidian:path.resolve('tests/obsidian-mock.ts')}});
const {LlmConfigurationModal,RuntimeConfigurationModal,ProviderDeclarationModal,Setting,friendlyError}=createRequire(import.meta.url)(bundle);
after(()=>rm(root,{recursive:true,force:true}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function harness(provider='deepseek',configured=false) {
  Setting.buttons=[]; Setting.texts=[];
  const events=[];
  const config={llm:{providers:[{id:provider,name:provider,configured,default_model:'test-model',models:[]}]}};
  const client={configuration:async()=>config,saveLlmCredential:async (...args)=>events.push(['save',...args]),
    testLlm:async (...args)=>{events.push(['test',...args]);return {provider,model:'test-model'};}};
  const host={getSettings:()=>({llmProvider:provider,llmModel:'test-model',analysisMode:'hybrid'}),client:()=>client};
  const modal=new LlmConfigurationModal({openedModals:[]},host,provider);
  modal.open();await flush();
  return {modal,host,config,client,events,input:Setting.texts.at(-1),save:Setting.buttons.find(b=>b.label==='保存密钥'),testConnection:Setting.buttons.find(b=>b.label==='测试连接')};
}
test('saving a key never makes an external model test; testing is explicit',async()=>{
  const h=await harness();
  assert.equal(h.testConnection.disabled,true);
  h.input.change('dummy-test-secret');await h.save.click();
  assert.equal(h.events.length,1);assert.equal(h.events[0][0],'save');
  assert.equal(h.testConnection.disabled,false);
  assert.match(h.modal.contentEl.textContent,/尚未测试/);
  await h.testConnection.click();assert.equal(h.events[1][0],'test');
  assert.deepEqual(h.events[1].slice(1),['deepseek','test-model']);
});
test('unsaved key input cannot silently test the previously stored credential',async()=>{
  const h=await harness('volcengine-ark',true);
  assert.equal(h.testConnection.disabled,false);
  h.input.change('replacement-test-secret');
  assert.equal(h.testConnection.disabled,true);await h.testConnection.click();assert.equal(h.events.length,0);
  assert.match(h.modal.contentEl.textContent,/尚待官方确认/);
});
test('save is mutually exclusive and closed modal does not start new requests',async()=>{
  const h=await harness();let finish;
  h.client.saveLlmCredential=()=>{h.events.push(['save']);return new Promise(resolve=>{finish=resolve;});};
  h.input.change('dummy-test-secret');
  const task=h.save.click();await h.save.click();await h.testConnection.click();
  assert.equal(h.events.length,1);h.modal.close();finish();await task;
  await h.testConnection.click();assert.equal(h.events.length,1);
});
test('connection failure keeps saved credential and does not switch providers',async()=>{
  const h=await harness('deepseek',true);
  h.client.testLlm=async provider=>{h.events.push(provider);throw new Error('DeepSeek HTTP 401');};
  await h.testConnection.click();assert.deepEqual(h.events,['deepseek']);
  assert.match(h.modal.contentEl.textContent,/DeepSeek 鉴权失败/);
  assert.equal(h.testConnection.disabled,false);
});

test('repeated connection clicks issue only one request while pending',async()=>{
  const h=await harness('deepseek',true);let finish;
  h.client.testLlm=()=>{h.events.push(['test']);return new Promise(resolve=>{finish=resolve;});};
  const pending=h.testConnection.click();await h.testConnection.click();
  assert.equal(h.events.length,1);assert.equal(h.testConnection.disabled,true);
  finish({provider:'deepseek',model:'test-model'});await pending;
  assert.equal(h.testConnection.disabled,false);
});

test('failed first save leaves connection testing disabled and permits retry',async()=>{
  const h=await harness();
  h.client.saveLlmCredential=async()=>{throw new Error('storage unavailable');};
  h.input.change('dummy-test-secret');await h.save.click();
  assert.equal(h.testConnection.disabled,true);assert.equal(h.save.disabled,false);
  assert.match(h.modal.contentEl.textContent,/保存失败/);
  await h.testConnection.click();assert.equal(h.events.length,0);
});
test('selected Coding Plan always shows an unconfirmed-scope notice',async()=>{
  const h=await harness('volcengine-ark',true);
  const modal=new RuntimeConfigurationModal({openedModals:[]},h.host,h.config);
  modal.open();assert.match(modal.contentEl.textContent,/尚待官方确认/);
  assert.match(modal.contentEl.textContent,/不会自动切换计费接口/);
});
test('errors retain correct provider identity and redact common credential formats',()=>{
  assert.match(friendlyError(new Error('Tencent Token Plan HTTP 403')),/腾讯云/);
  assert.match(friendlyError(new Error('Tencent Token Plan API key is not configured')),/腾讯云/);
  assert.match(friendlyError(new Error('DeepSeek HTTP 401 unauthorized')),/DeepSeek/);
  assert.match(friendlyError(new Error('Ark HTTP 403 unauthorized')),/火山/);
  assert.doesNotMatch(friendlyError(new Error('HTTP 401 unauthorized')),/火山|DeepSeek/);
  assert.doesNotMatch(friendlyError(new Error('HTTP 402')),/火山|DeepSeek/);
  const result=friendlyError(new Error('debug sk-dummy_test-123 Bearer other-test-secret'));
  assert.doesNotMatch(result,/sk-dummy|other-test-secret/);
});

function findButton(node, label) {
  if (node.tag === 'button' && node.options?.attr?.['aria-label'] === label) return node;
  for (const child of node.children) { const found=findButton(child,label); if(found) return found; }
}

test('Tencent save and explicit test keep the provider identity and warning',async()=>{
  const h=await harness('tencent-token-plan');
  assert.match(h.modal.contentEl.textContent,/禁止用于自定义应用程序后端/);
  h.input.change('dummy-tencent-secret');await h.save.click();
  assert.deepEqual(h.events.map(e=>e[0]),['save']);
  await h.testConnection.click();
  assert.deepEqual(h.events[1],['test','tencent-token-plan','test-model']);
});

test('declaration opens beside settings and back preserves the unsaved selection',async()=>{
  const h=await harness('tencent-token-plan');
  const modal=new RuntimeConfigurationModal(h.modal.app,h.host,h.config);
  modal.open();
  const before=JSON.stringify(h.host.getSettings());
  findButton(modal.contentEl,'LLM 接入声明').onclick();
  const declaration=h.modal.app.openedModals.at(-1);
  assert.ok(declaration instanceof ProviderDeclarationModal);
  const text=declaration.contentEl.textContent;
  for(const phrase of ['DeepSeek 官网 API','火山 Coding Plan','腾讯云 Token Plan','尚待官方确认','不替代服务商授权','--dossier-llm']) assert.ok(text.includes(phrase));
  findButton(declaration.contentEl,'返回 LLM 设置').onclick();
  assert.equal(JSON.stringify(h.host.getSettings()),before);
  assert.match(modal.contentEl.textContent,/回答模式/);
  assert.equal(h.events.length,0);
});
