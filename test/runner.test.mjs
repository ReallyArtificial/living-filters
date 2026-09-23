import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFilter, rank } from '../src/runner.mjs';
import { loadSeen, saveSeen, seenPath } from '../src/seen.mjs';
import { noul, decision } from '../src/questions.mjs';

// A minimal filter: one noul question, show when >= 0.5.
const synthetic = {
  kind: 'synthetic',
  key: (item) => `${item.id}@${item.rev}`, label: (item) => item.id, title: () => 't', url: () => 'u', tags: () => [],
  preflight: (_c, item) => item.skip ? decision('hide', 'skipped', { score: 0 }) : undefined,
  state: (_c, item) => ({ v: item.v }),
  questions: () => ({ ok: noul('Is `v` acceptable?') }),
  decide: (_s, a) => a.ok.noul >= 0.5 ? decision('show', 'fine', { score: a.ok.noul }) : decision('hide', 'low', { score: 0 }),
};
const items = (n, rev = 1) => Array.from({ length: n }, (_, i) => ({ id: `item-${String(i + 1).padStart(2, '0')}`, rev, v: i }));
const stubClient = (calls, { failAt = Infinity, noulOf = () => 0.7 } = {}) => async (request) => {
  calls.push(request);
  if (calls.length === failAt) throw new Error('Jev HTTP 529. Overloaded.');
  return { response: { model: 'jev-1.13.0', answers: { ok: { type: 'noul', noul: noulOf(request) } }, usage: { input_tokens: 100, output_tokens: 0 } }, elapsedMs: 1, attempts: 1 };
};

test('the cap bounds paid judgments; capped items are reported but not stored', async () => {
  const calls = [];
  const run = await runFilter(synthetic, {}, items(30), { live: true, client: stubClient(calls), limit: 5 });
  assert.equal(calls.length, 5);
  assert.equal(run.summary.judged, 5);
  assert.equal(run.summary.capped, 25);
  assert.equal(run.summary.inputTokens, 500);
  assert.equal(run.summary.estimatedCostUsd, 0.000021);
  assert.deepEqual(Object.keys(run.seen).sort(), items(5).map(synthetic.key));
  assert.ok(run.results.filter(r => r.provenance === 'cap').every(r => r.outcome.action === 'needs-more-info' && !(r.key in run.seen)));
});

test('a second run reuses stored verdicts and spends the cap on unjudged items only', async () => {
  const first = [], second = [];
  const run1 = await runFilter(synthetic, {}, items(12), { live: true, client: stubClient(first), limit: 5 });
  const run2 = await runFilter(synthetic, {}, items(12), { live: true, client: stubClient(second), limit: 5, seen: run1.seen });
  assert.equal(second.length, 5);
  assert.equal(run2.summary.fromSeenStore, 5);
  assert.equal(run2.summary.judged, 5);
  assert.equal(run2.summary.capped, 2);
  assert.equal(Object.keys(run2.seen).length, 10);
  assert.ok(run2.results.filter(r => r.provenance === 'seen-store').every(r => r.outcome.action === 'show' && r.outcome.score === 0.7));
});

test('--all re-judges stored items; a changed key is a new item', async () => {
  const calls = [];
  const run1 = await runFilter(synthetic, {}, items(3), { live: true, client: stubClient(calls), limit: 10 });
  await runFilter(synthetic, {}, items(3), { live: true, client: stubClient(calls), limit: 10, seen: run1.seen, all: true });
  assert.equal(calls.length, 6);
  await runFilter(synthetic, {}, items(3, 2), { live: true, client: stubClient(calls), limit: 10, seen: run1.seen });
  assert.equal(calls.length, 9);
  assert.equal(Object.keys(run1.seen).length, 6);
});

test('preflight items cost nothing and are never stored; dry runs send nothing', async () => {
  const calls = [];
  const mixed = [...items(4), { id: 'skip-me', rev: 1, v: 0, skip: true }];
  const live = await runFilter(synthetic, {}, mixed, { live: true, client: stubClient(calls), limit: 10 });
  assert.equal(calls.length, 4);
  assert.equal(live.summary.preflight, 1);
  assert.ok(!('skip-me@1' in live.seen));
  const dry = await runFilter(synthetic, {}, mixed, { live: false, client: stubClient(calls), limit: 10 });
  assert.equal(calls.length, 4);
  assert.equal(dry.summary.wouldSend, 4);
  assert.equal(dry.summary.estimatedCostUsd, null);
});

test('a client failure mid-run keeps the verdicts already paid for and reports the error', async () => {
  const calls = [];
  const run = await runFilter(synthetic, {}, items(6), { live: true, client: stubClient(calls, { failAt: 3 }), limit: 10 });
  assert.match(run.error.message, /529/);
  assert.equal(Object.keys(run.seen).length, 2);
  assert.equal(run.results.length, 2);
  assert.equal(run.summary.judged, 2);
});

test('rank puts every show above every needs-more-info regardless of score, then score desc, then key', () => {
  const r = (key, action, score) => ({ key, outcome: { action, score } });
  const ranked = rank([r('c', 'hide', 0), r('b', 'needs-more-info', 0.99), r('a', 'show', 0.2), r('d', 'show', 0.9), r('e', 'show', 0.2)]).map(x => x.key);
  assert.deepEqual(ranked, ['d', 'a', 'e', 'b', 'c']);
});

test('the seen store round-trips through disk under LIVING_FILTERS_HOME', () => {
  process.env.LIVING_FILTERS_HOME = mkdtempSync(join(tmpdir(), 'lf-'));
  assert.deepEqual(loadSeen('weekend-fixes'), {});
  const verdicts = { 'acme/w#1@2026-09-01T00:00:00Z': { action: 'show', reason: 'fine', score: 0.8, judgedAt: '2026-09-23T00:00:00.000Z', model: 'jev-1.13.0' } };
  const path = saveSeen('weekend-fixes', verdicts);
  assert.equal(path, seenPath('weekend-fixes'));
  assert.ok(existsSync(path));
  assert.deepEqual(loadSeen('weekend-fixes'), verdicts);
  delete process.env.LIVING_FILTERS_HOME;
});
