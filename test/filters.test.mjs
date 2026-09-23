import test from 'node:test';
import assert from 'node:assert/strict';
import { filters } from '../src/filters/index.mjs';
import { judgeItem, runCases, prepare } from '../src/runner.mjs';
import { choice, score } from '../src/fixtures.mjs';

const neverCall = () => assert.fail('fixture mode called the client');
const weekend = filters['weekend-fixes'], stack = filters['stack-breakers'];
const caseOf = (filter, id) => filter.cases.find(c => c.id === id);
const judge = (filter, item, fixture, config = filter.caseConfig) => judgeItem(filter, config, item, { client: neverCall, fixture }).then(r => r.outcome);

for (const filter of Object.values(filters)) {
  test(`${filter.kind}: every authored case matches its intended outcome without a model call`, async () => {
    const { results, summary } = await runCases(filter, { client: neverCall });
    for (const r of results) assert.ok(r.matchesExpected, `${r.case}: got ${JSON.stringify(r.outcome)}, expected ${JSON.stringify(r.expected)}`);
    assert.equal(summary.matchesExpected, filter.cases.length);
    for (const r of results) if (r.request) assert.deepEqual(Object.keys(r.request).sort(), ['model', 'questions', 'state']);
  });
}

test('weekend-fixes: preflight cases never build a request, even in live mode', async () => {
  const c = caseOf(weekend, 'assigned-already');
  const r = await judgeItem(weekend, weekend.caseConfig, c.item, { live: true, client: neverCall });
  assert.equal(r.request, null);
  assert.equal(r.provenance, 'deterministic-preflight-no-model-call');
});

test('weekend-fixes: an unconfident effort answer asks instead of showing', async () => {
  const c = caseOf(weekend, 'small-clear-fit');
  const fixture = { ...c.fixture, effort: choice({ under_4h: 0.9, hours_4_12: 0.1, days: 0, unknowable: 0 }, 0.5) };
  assert.equal((await judge(weekend, c.item, fixture)).action, 'needs-more-info');
  assert.equal((await judge(weekend, c.item, c.fixture)).action, 'show');
});

test('weekend-fixes: fit is a three-band gate, not a coin flip', async () => {
  const c = caseOf(weekend, 'small-clear-fit');
  assert.equal((await judge(weekend, c.item, { ...c.fixture, fit: 0.2 })).action, 'hide');
  assert.equal((await judge(weekend, c.item, { ...c.fixture, fit: 0.5 })).action, 'needs-more-info');
  assert.equal((await judge(weekend, c.item, { ...c.fixture, fit: 0.95 })).action, 'show');
});

test('weekend-fixes: multi-day effort hides even a perfect fit', async () => {
  const c = caseOf(weekend, 'small-clear-fit');
  const fixture = { ...c.fixture, effort: choice({ under_4h: 0, hours_4_12: 0, days: 1, unknowable: 0 }), fit: 0.99 };
  assert.equal((await judge(weekend, c.item, fixture)).action, 'hide');
});

test('weekend-fixes: a 4-12 hour issue depends on the hours in the config', async () => {
  const c = caseOf(weekend, 'small-clear-fit');
  const fixture = { ...c.fixture, effort: choice({ under_4h: 0.1, hours_4_12: 0.9, days: 0, unknowable: 0 }) };
  assert.equal((await judge(weekend, c.item, fixture, { ...weekend.caseConfig, hours: 3 })).action, 'hide');
  assert.equal((await judge(weekend, c.item, fixture, { ...weekend.caseConfig, hours: 8 })).action, 'show');
});

test('weekend-fixes: an unclear scope asks for more information', async () => {
  const c = caseOf(weekend, 'small-clear-fit');
  assert.equal((await judge(weekend, c.item, { ...c.fixture, scope: score({ 0: 1, 1: 0, 2: 0, 3: 0 }) })).action, 'needs-more-info');
});

test('weekend-fixes: under four hours outranks four to twelve at equal fit and scope', async () => {
  const c = caseOf(weekend, 'small-clear-fit');
  const small = await judge(weekend, c.item, c.fixture);
  const medium = await judge(weekend, c.item, { ...c.fixture, effort: choice({ under_4h: 0.1, hours_4_12: 0.9, days: 0, unknowable: 0 }) });
  assert.equal(medium.action, 'show');
  assert.ok(small.score > medium.score, `${small.score} should exceed ${medium.score}`);
});

test('weekend-fixes: preflight rules each stop the request for the right reason', async () => {
  const base = caseOf(weekend, 'small-clear-fit').item;
  const config = weekend.caseConfig;
  const run = (over) => prepare(weekend, config, { ...base, ...over });
  assert.equal(run({ labels: ['WontFix'] }).preflight.action, 'hide');
  assert.equal(run({ assignees: 1 }).preflight.reason, 'Already assigned.');
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString(), recent = new Date(Date.now() - 100 * 86_400_000).toISOString();
  assert.equal(run({ comments: 0, updated_at: old }).preflight.action, 'hide');
  assert.ok(run({ comments: 0, updated_at: recent }).request, 'a recently updated unanswered issue is still judged');
  assert.ok(run({ comments: 3, updated_at: old }).request, 'an old issue with discussion is still judged');
  assert.equal(run({ body: 'Fix it.' }).preflight.action, 'needs-more-info');
  assert.ok(run({}).request, 'the untouched item reaches the model');
});

test('stack-breakers: additive releases hide, documented breaks show only when the stack is affected', async () => {
  const c = caseOf(stack, 'major-documented-breaking');
  assert.equal((await judge(stack, c.item, { ...c.fixture, breaks: choice({ breaking_documented: 0, behavior_change: 0, additive: 1, unclear: 0 }) })).action, 'hide');
  assert.equal((await judge(stack, c.item, { ...c.fixture, affects_stack: 0.1 })).action, 'hide');
  assert.equal((await judge(stack, c.item, { ...c.fixture, affects_stack: 0.9 })).action, 'show');
  assert.equal((await judge(stack, c.item, { ...c.fixture, breaks: choice({ breaking_documented: 0, behavior_change: 0, additive: 0, unclear: 1 }) })).action, 'needs-more-info');
  assert.equal((await judge(stack, c.item, { ...c.fixture, breaks: choice({ breaking_documented: 0.6, behavior_change: 0.4, additive: 0, unclear: 0 }, 0.6) })).action, 'needs-more-info');
});

test('stack-breakers: a documented major outranks a behavior-change minor at the same exposure', async () => {
  const c = caseOf(stack, 'major-documented-breaking');
  const major = await judge(stack, c.item, c.fixture);
  const minorItem = { ...c.item, tag: 'v3.26.0', version: '3.26.0', bump: 'minor' };
  const minor = await judge(stack, minorItem, { ...c.fixture, breaks: choice({ breaking_documented: 0.1, behavior_change: 0.9, additive: 0, unclear: 0 }) });
  assert.equal(minor.action, 'show');
  assert.ok(major.score > minor.score, `${major.score} should exceed ${minor.score}`);
});

test('stack-breakers: preflight rules each stop the request for the right reason', () => {
  const base = caseOf(stack, 'major-documented-breaking').item;
  const run = (over) => prepare(stack, stack.caseConfig, { ...base, ...over });
  assert.equal(run({ tag: 'v4.0.0-beta.1', version: '4.0.0-beta.1', prerelease: true }).preflight.action, 'hide');
  assert.equal(run({ tag: 'v3.25.76', version: '3.25.76', bump: 'none' }).preflight.reason, 'Not newer than the installed version.');
  assert.equal(run({ version: '3.25.77', bump: 'patch', body: 'Fix a typo in the docs.' }).preflight.action, 'hide');
  assert.ok(run({ version: '3.25.77', bump: 'patch', body: 'BREAKING: dropped Node 16 support.' }).request, 'a patch with a breaking keyword is judged');
  assert.equal(run({ body: '' }).preflight.action, 'needs-more-info');
  assert.ok(run({}).request, 'the untouched item reaches the model');
});
