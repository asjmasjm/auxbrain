import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const root = await mkdtemp(path.join(tmpdir(), 'auxbrain-v2-'));
const bundle = path.join(root, 'test.cjs');
await build({ stdin: { contents: `export * from './src/contracts'; export * from './src/dossier-jobs'; export * from './src/paper-library-client'; export * from './src/api';`, resolveDir: process.cwd() },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', alias: { obsidian: path.resolve('tests/obsidian-mock.ts') } });
const { answerConfidence, evidenceHighlightText, DossierJobTracker, PaperLibraryClient, AuxBrainClient } = createRequire(import.meta.url)(bundle);
after(() => rm(root, { recursive: true, force: true }));
globalThis.window = globalThis;
const wait = () => new Promise(resolve => setTimeout(resolve, 20));

test('uncalibrated confidence is not zero accuracy; old numeric confidence remains supported', () => {
  for (const confidence of [null, undefined, NaN, Infinity, -1, 1.1]) assert.equal(answerConfidence({ confidence }), null);
  assert.equal(answerConfidence({ confidence: 0 }), 0);
  assert.equal(answerConfidence({ confidence: .72 }), .72);
  assert.equal(answerConfidence({ confidence: .72, dossier: { confidence_status: 'uncalibrated' } }), null);
});
test('highlight body must remain part of the original quote', () => {
  const evidence = { text: '# Experiments\nWe train on Bridge V2.', locator: { highlight_text: 'We train on Bridge V2.' } };
  assert.equal(evidenceHighlightText(evidence), evidence.locator.highlight_text);
  for (const highlight_text of ['', 'unrelated text', 13]) assert.equal(evidenceHighlightText({ ...evidence, locator: { highlight_text } }), evidence.text);
});
test('v2 contribution states preserve pending/failed/completed and absent jobs remain unknown', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dossiers-v1.json', import.meta.url), 'utf8'));
  for (const [state, expected] of [['queued','pending'],['running','pending'],['failed','failed'],['completed','completed'],[null,'unknown']]) {
    const client = new PaperLibraryClient('', async route => {
      const response = structuredClone(fixture.responses[route.replace(/&sort=[^&]+&order=[^&]+$/, '')]);
      if (route.includes('/contributions')) response.json.questions[0].job = state ? { job_id: 'job-test', state } : null;
      return response;
    });
    await client.list('', 'updated');
    const paper = await client.detail(fixture.work_id);
    assert.equal(paper.contributions.contributions[0].status, expected);
    assert.equal(paper.contributions.contributions[0].job_id, state ? 'job-test' : null);
  }
});
test('background tracker reaches terminal state without holding the answer workflow', async () => {
  const updates = [];
  const tracker = new DossierJobTracker(async id => ({ job_id: id, state: 'completed' }), (job, error) => updates.push([job.state, error]), 1);
  tracker.start({ job_id: 'test', state: 'queued' });
  assert.deepEqual(updates, [['queued', '']]);
  await wait();
  assert.deepEqual(updates, [['queued', ''], ['completed', '']]);
  tracker.stop();
});
test('stopped background tracking ignores late replies and bounds retries', async () => {
  let resolve;
  const updates = [];
  const tracker = new DossierJobTracker(() => new Promise(done => { resolve = done; }), (job, error) => updates.push([job.state, error]), 1);
  tracker.start({ job_id: 'old', state: 'running' }); await wait(); tracker.stop();
  resolve({ job_id: 'old', state: 'completed' }); await wait();
  assert.equal(updates.length, 1);
  const bounded = new DossierJobTracker(async id => ({ job_id: id, state: 'running' }), (_, error) => { if (error) updates.push(error); }, 1, 1);
  bounded.start({ job_id: 'new', state: 'queued' }); await wait(); bounded.stop();
  assert.match(updates.at(-1), /暂停/);
});
test('network failure is a sync problem, not fabricated failed organization', async () => {
  const updates = [];
  const tracker = new DossierJobTracker(async () => { throw new Error('offline'); }, (job, error) => updates.push([job.state, error]), 1);
  tracker.start({ job_id: 'test', state: 'running' }); await wait(); tracker.stop();
  assert.equal(updates.at(-1)[0], 'running'); assert.match(updates.at(-1)[1], /无法同步/);
});
test('client transmits the supplied retry key and creates fresh keys for new questions', async () => {
  const keys = [];
  globalThis.__requestUrl = async options => {
    keys.push(JSON.parse(options.body).request_key);
    return { status: 200, json: { status: 'completed', result: { answer: 'test' } } };
  };
  try {
    const client = new AuxBrainClient('http://127.0.0.1');
    const args = [{ text: 'source', sourcePath: 'test.pdf', title: 'Test' }, 'Question', 1, {}];
    await client.understand(...args, undefined, 'retry-key');
    await client.understand(...args, undefined, 'retry-key');
    await client.understand(...args); await client.understand(...args);
    assert.deepEqual(keys.slice(0, 2), ['retry-key', 'retry-key']);
    assert.notEqual(keys[2], keys[3]); assert.ok(keys[2]);
  } finally { delete globalThis.__requestUrl; }
});
