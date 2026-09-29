import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { makePaper, legacyRelation } from "./paper-library-fixture.mjs";

const root = await mkdtemp(path.join(tmpdir(), "auxbrain-library-"));
const bundle = path.join(root, "library.cjs");
await build({ stdin: { contents: `export * from './src/paper-library-client'; export { safeExternalUrl } from './src/paper-library-view';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", outfile: bundle, alias: { obsidian: path.resolve("tests/obsidian-mock.ts") } });
const { PaperLibraryClient, legacyPaperDetails, safeExternalUrl, localLibraryUrl } = createRequire(import.meta.url)(bundle);
after(() => rm(root, { recursive: true, force: true }));
const reply = json => ({ status: 200, json: { schema_version: 1, ...json } });
const proposedApi = transport => path => path.startsWith("/api/v1/dossiers") ? Promise.resolve({ status: 404, json: {} }) : transport(path);

test("native list encodes search and cursor and preserves stable identity", async () => {
  const paths = [];
  const client = new PaperLibraryClient("", proposedApi(async path => { paths.push(path); return reply({ papers: [makePaper()], total: 1, next_cursor: null }); }));
  const page = await client.list("a&b", "title", "cursor/1");
  const url = new URL(paths[0], "http://localhost");
  assert.equal(url.searchParams.get("query"), "a&b");
  assert.equal(url.searchParams.get("cursor"), "cursor/1");
  assert.equal(page.mode, "native"); assert.equal(page.papers[0].paper_id, "test-paper-a");
});
test("legacy fallback uses only real accepted relations and does not invent disclosure", async () => {
  const calls = [];
  const client = new PaperLibraryClient("", async path => {
    calls.push(path);
    return path.startsWith("/api/v1/library/") || path.startsWith("/api/v1/dossiers") ? { status: 404, json: {} } : { status: 200, json: {
      relations: [legacyRelation("a"), legacyRelation("b", "obsidian://different.pdf")], total: 600, entity_count: 2
    } };
  });
  const page = await client.list("", "updated");
  assert.equal(page.papers.length, 2); assert.equal(page.legacy_limit.total, 600);
  assert.equal(page.papers[0].counts.explored_sections, null);
  assert.equal(page.papers[0].counts.questions, null);
  assert.deepEqual(page.papers[0].metadata.authors, []);
  const detail = await client.detail(page.papers[0].paper_id);
  assert.equal(detail.legacy_relations.length, 1); assert.deepEqual(detail.contributions.contributions, []);
  assert.equal(calls.length, 3);
});
test("legacy records without identity are not merged by title; duplicate assertions count once", () => {
  const a = legacyRelation("a", ""), b = legacyRelation("b", "");
  const papers = legacyPaperDetails({ relations: [a, a, b], total: 3, entity_count: 0 });
  assert.equal(papers.length, 2); assert.equal(papers[0].counts.confirmed, 1);
});
test("legacy stable paper ID wins over document aliases", () => {
  const papers = legacyPaperDetails({ relations: [
    { ...legacyRelation("a", "obsidian://a.pdf"), paper_id: "stable" },
    { ...legacyRelation("b", "obsidian://renamed.pdf"), paper_id: "stable" }
  ], total: 2, entity_count: 0 });
  assert.equal(papers.length, 1); assert.equal(papers[0].counts.confirmed, 2);
});
test("network, authorization, and server errors do not masquerade as old backend", async () => {
  for (const status of [401, 403, 500, 503]) {
    let calls = 0;
    const client = new PaperLibraryClient("", async () => { calls++; return { status, json: {} }; });
    await assert.rejects(client.list("", "updated"), new RegExp(String(status))); assert.equal(calls, 1);
  }
  const client = new PaperLibraryClient("", async () => { throw new Error("offline"); });
  await assert.rejects(client.list("", "updated"), /offline/);
});
test("unknown schema and malformed counts are explicit compatibility errors", async () => {
  for (const json of [
    { schema_version: 2, papers: [], total: 0, next_cursor: null },
    { schema_version: 1, papers: [ { ...makePaper(), counts: { confirmed: -1 } } ], total: 1, next_cursor: null },
    { schema_version: 1, papers: [makePaper(), makePaper()], total: 2, next_cursor: null }
  ]) {
    const client = new PaperLibraryClient("", proposedApi(async () => ({ status: 200, json })));
    await assert.rejects(client.list("", "updated"), /格式不兼容/);
  }
});
test("detail rejects a different paper and omitted section states", async () => {
  let paper = makePaper("wrong");
  const client = new PaperLibraryClient("", async () => reply({ paper }));
  await assert.rejects(client.detail("expected"), /格式不兼容/);
  paper = makePaper("expected"); paper.sections.pop();
  await assert.rejects(client.detail("expected"), /格式不兼容/);
});
test("native detail and paginated contribution events preserve evidence and changes", async () => {
  const paper = makePaper();
  const client = new PaperLibraryClient("", async path => path.includes("/contributions?")
    ? reply(paper.contributions) : reply({ paper }));
  const detail = await client.detail(paper.paper_id);
  assert.equal(detail.sections[3].items[0].evidence[0].locator.page, 3);
  const events = await client.contributions(paper.paper_id, "cursor");
  assert.equal(events.contributions[0].changes[0].kind, "added");
  assert.equal(events.contributions[1].changes.length, 0);
});
test("unknown contribution kinds and unsafe locator values are rejected", async () => {
  const paper = makePaper(); paper.contributions.contributions[0].changes[0].kind = "invented";
  let client = new PaperLibraryClient("", async () => reply({ paper }));
  await assert.rejects(client.detail(paper.paper_id), /格式不兼容/);
  const valid = makePaper(); valid.sections[3].items[0].evidence[0].locator.page = -1;
  client = new PaperLibraryClient("", async () => reply({ paper: valid }));
  await assert.rejects(client.detail(valid.paper_id), /格式不兼容/);
});
test("metadata links never execute scripts or open local resources", () => {
  for (const url of ["javascript:alert(1)", "file:///secret", "obsidian://run", "data:text/html,test", null]) assert.equal(safeExternalUrl(url), null);
  assert.equal(safeExternalUrl("https://arxiv.org/abs/test"), "https://arxiv.org/abs/test");
});

test("real dossier HTTP fixture maps work IDs, eight sections, stale-safe evidence and raw contribution events", async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dossiers-v1.json', import.meta.url), 'utf8'));
  const calls = [];
  const client = new PaperLibraryClient('', async route => {
    calls.push(route);
    const result = fixture.responses[route.replace(/&sort=[^&]+&order=[^&]+$/, '')]; assert.ok(result, route); return structuredClone(result);
  });
  const page = await client.list('', 'updated');
  assert.equal(page.mode, 'native'); assert.equal(page.sorting, false); assert.equal(page.papers.length, 2);
  assert.notEqual(page.papers[0].paper_id, page.papers[1].paper_id);
  const paper = await client.detail(fixture.work_id);
  assert.equal(paper.sections.length, 8); assert.equal(paper.metadata.authors[0].name, 'Test Author');
  assert.equal(paper.metadata.versions[0].date, '2026-09-01'); assert.equal(paper.counts.confirmed, 1);
  assert.equal(paper.counts.questions, 1); assert.equal(paper.updated_at, null);
  const item = paper.sections.find(s => s.key === 'method').items[0];
  assert.equal(item.kind, 'paper_statement'); assert.equal(item.confidence, null);
  assert.deepEqual(item.evidence[0].locator, {}); assert.equal(item.evidence[0].source_path, null);
  const q = paper.contributions.contributions[0];
  assert.equal(q.status, 'unknown'); assert.ok(q.changes.some(c => c.kind === 'revealed'));
  assert.ok(q.changes.every(c => c.section_key));
  assert.equal(calls.length, 4);
});
test("dossier unsupported section schemas do not silently degrade to a legacy empty library", async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dossiers-v1.json', import.meta.url), 'utf8'));
  const client = new PaperLibraryClient('', async route => {
    const response = structuredClone(fixture.responses[route.replace(/&sort=[^&]+&order=[^&]+$/, '')]);
    if (route.endsWith(fixture.work_id)) response.json.sections[0].section = 'unexpected';
    return response;
  });
  await client.list('', 'updated');
  await assert.rejects(client.detail(fixture.work_id), /不兼容/);
});
test("library service requests stay on loopback and reject credentials or remote endpoints", () => {
  for (const url of ['https://example.org', 'http://localhost.evil.test', 'http://user:secret@localhost', 'file:///x', 'http://127.0.0.1?key=secret']) {
    assert.throws(() => localLibraryUrl(url));
  }
  assert.equal(localLibraryUrl('http://127.0.0.1:8766/'), 'http://127.0.0.1:8766');
  assert.equal(localLibraryUrl('http://[::1]:8766'), 'http://[::1]:8766');
});
