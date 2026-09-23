import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { evaluate, DEFAULT_MODEL } from './client.mjs';
import { fixtureResponse } from './fixtures.mjs';
import { validateRequest, validateResponse } from './contract.mjs';
import { decision } from './questions.mjs';

// Pricing snapshot: official /models, verified 2026-09-22. Applied only to this exact model.
const PRICED_MODEL = 'jev-1.13.0', USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const ORDER = { show: 0, 'needs-more-info': 1, hide: 2 };

export const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const costOf = (response) => response?.model === PRICED_MODEL ? response.usage.input_tokens * USD_PER_INPUT_TOKEN : null;

export function prepare(filter, config, item, model = DEFAULT_MODEL) {
  const preflight = filter.preflight(config, item);
  if (preflight) return { preflight, request: null };
  return { preflight: null, request: validateRequest({ model, state: filter.state(config, item), questions: filter.questions(config) }) };
}

const row = (filter, item, extra) => ({ key: filter.key(item), label: filter.label(item), title: filter.title(item), url: filter.url(item), tags: filter.tags(item), item, request: null, response: null, inputTokens: 0, elapsedMs: null, ...extra });

export async function judgeItem(filter, config, item, { live = false, model = DEFAULT_MODEL, client = evaluate, fixture = {} } = {}) {
  const { preflight, request } = prepare(filter, config, item, model);
  let response = null, elapsedMs = null, attempts = 0;
  if (request) {
    if (live) ({ response, elapsedMs, attempts } = await client(request));
    else response = fixtureResponse(request.questions, fixture);
    validateResponse(response, request.questions);
  }
  const outcome = preflight ?? filter.decide(request.state, response.answers);
  return row(filter, item, {
    request, requestSha256: request ? digest(request) : null, response, outcome, elapsedMs, attempts,
    provenance: preflight ? 'deterministic-preflight-no-model-call' : live ? 'live-typesafe-api' : 'hand-authored-illustration-not-model-output',
    inputTokens: response?.usage.input_tokens ?? 0, estimatedCostUsd: live ? costOf(response) : null,
  });
}

export const matchesExpected = (outcome, c) => outcome.action === c.expected && Object.entries(c.expectedDetails ?? {}).every(([k, v]) => isDeepStrictEqual(outcome[k], v));

export async function runCases(filter, { live = false, model = DEFAULT_MODEL, client = evaluate } = {}) {
  const results = [];
  for (const c of filter.cases) {
    const r = await judgeItem(filter, filter.caseConfig, c.item, { live, model, client, fixture: c.fixture });
    results.push({ ...r, case: c.id, note: c.note, expected: { action: c.expected, ...c.expectedDetails }, matchesExpected: matchesExpected(r.outcome, c) });
  }
  return {
    results,
    summary: {
      cases: results.length, matchesExpected: results.filter(r => r.matchesExpected).length,
      preflightDecisions: results.filter(r => r.request === null).length, liveRequests: results.filter(r => r.provenance === 'live-typesafe-api').length,
      interpretation: 'Agreement with a small authored teaching set, not measured general accuracy. Fixtures exercise application policy only.',
    },
  };
}

export const rank = (results) => [...results].sort((a, b) =>
  (ORDER[a.outcome?.action] ?? 3) - (ORDER[b.outcome?.action] ?? 3) || (b.outcome?.score ?? 0) - (a.outcome?.score ?? 0) || a.key.localeCompare(b.key));

// One request per item. Paid verdicts are stored in `seen`; preflight verdicts are free and recomputed every run.
export async function runFilter(filter, config, items, { live = false, model = DEFAULT_MODEL, client = evaluate, seen = {}, all = false, limit = 25, onProgress = () => {} } = {}) {
  const results = [];
  const started = performance.now();
  let judged = 0, inputTokens = 0, pricedTokens = 0, error = null;
  try {
    for (const item of items) {
      const key = filter.key(item);
      const stored = seen[key];
      if (stored && !all) { results.push(row(filter, item, { outcome: decision(stored.action, stored.reason, { score: stored.score }), provenance: 'seen-store' })); continue; }
      const { preflight, request } = prepare(filter, config, item, model);
      if (preflight) { results.push(row(filter, item, { outcome: preflight, provenance: 'deterministic-preflight-no-model-call' })); continue; }
      if (!live) { results.push(row(filter, item, { request, outcome: null, provenance: 'dry-run-not-sent' })); continue; }
      if (judged >= limit) { results.push(row(filter, item, { request, outcome: decision('needs-more-info', `Judgment cap (${limit}) reached; rerun to continue.`, { score: 0 }), provenance: 'cap' })); continue; }
      onProgress(judged + 1, limit, filter.label(item));
      const { response, elapsedMs, attempts } = await client(request);
      try { validateResponse(response, request.questions); } catch (e) {
        // One malformed answer marks one item; it is not stored, so the next run retries it.
        results.push(row(filter, item, { request, response, outcome: decision('needs-more-info', `Response failed the contract (${e.message}); rerun to retry.`, { score: 0 }), provenance: 'invalid-response', elapsedMs, attempts, inputTokens: response?.usage?.input_tokens ?? 0 }));
        judged++; inputTokens += response?.usage?.input_tokens ?? 0;
        continue;
      }
      judged++; inputTokens += response.usage.input_tokens; if (response.model === PRICED_MODEL) pricedTokens += response.usage.input_tokens;
      const outcome = filter.decide(request.state, response.answers);
      results.push(row(filter, item, { request, requestSha256: digest(request), response, outcome, provenance: 'live-typesafe-api', elapsedMs, attempts, inputTokens: response.usage.input_tokens, estimatedCostUsd: costOf(response) }));
      seen[key] = { action: outcome.action, reason: outcome.reason, score: outcome.score, judgedAt: new Date().toISOString(), model: response.model };
    }
  } catch (e) { error = e; }
  const count = (p) => results.filter(r => r.provenance === p).length;
  return {
    results, seen, error,
    summary: {
      fetched: items.length, preflight: count('deterministic-preflight-no-model-call'), judged, fromSeenStore: count('seen-store'), capped: count('cap'), invalidResponses: count('invalid-response'),
      wouldSend: count('dry-run-not-sent'), cap: limit, inputTokens, estimatedCostUsd: live ? Math.round(pricedTokens * USD_PER_INPUT_TOKEN * 1e8) / 1e8 : null, elapsedMs: Math.round(performance.now() - started),
    },
  };
}
