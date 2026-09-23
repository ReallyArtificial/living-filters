import { rank } from './runner.mjs';

export const DOCS_VERIFIED_ON = '2026-09-22';
const money = (usd) => usd == null ? 'n/a' : `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function casesReport(filter, { results, summary }, { mode, model }) {
  return { schemaVersion: 1, createdAt: new Date().toISOString(), kind: filter.kind, mode, requestedModel: model, docsVerifiedOn: DOCS_VERIFIED_ON, summary, results };
}

export function formatCases(filter, report) {
  const lines = [report.mode === 'live' ? `${filter.kind} · LIVE · ${report.requestedModel} · ${report.summary.cases} cases` : `${filter.kind} · FIXTURE · authored illustrations, not model output · ${report.summary.cases} cases`, ''];
  for (const r of report.results) {
    lines.push(`${r.case}`);
    lines.push(`  ${r.outcome.action} — ${r.outcome.reason}`);
    lines.push(`  Intended: ${r.expected.action}${r.expected.score !== undefined ? ` (score ${r.expected.score})` : ''} · ${r.matchesExpected ? 'match' : 'MISMATCH'} · ${r.provenance}`);
    if (r.response && r.provenance === 'live-typesafe-api') lines.push(`  ${r.response.model} · ${r.elapsedMs} ms (includes retries) · ${r.response.usage.input_tokens} input tokens`);
    lines.push('');
  }
  lines.push(`${report.summary.matchesExpected}/${report.summary.cases} intended outcomes matched. ${report.summary.preflightDecisions} preflight decisions. ${report.summary.liveRequests} live requests.`);
  return lines.join('\n');
}

export function runReport(filter, config, file, run, { mode, model }) {
  const results = rank(run.results).map((r, i) => ({ rank: i + 1, ...r }));
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), filter: { name: config.name, kind: filter.kind, file }, mode, requestedModel: model,
    docsVerifiedOn: DOCS_VERIFIED_ON, summary: run.summary, results, errors: run.error ? [run.error.message] : [],
  };
}

export function formatRun(filter, report, seenFile) {
  const s = report.summary;
  const lines = [`${report.filter.name} · ${report.mode === 'live' ? `LIVE · ${report.requestedModel}` : 'DRY RUN'} · ${s.fetched} items · ${s.preflight} preflight · ${s.judged} judged (cap ${s.cap}) · ${s.fromSeenStore} from seen store`, ''];
  if (report.mode !== 'live') {
    const pending = report.results.filter(r => r.provenance === 'dry-run-not-sent');
    for (const r of pending) lines.push(`  ${r.label}   ${r.title}`);
    lines.push('');
    for (const [reason, n] of countBy(report.results.filter(r => r.provenance === 'deterministic-preflight-no-model-call'), r => r.outcome.reason)) lines.push(`  preflight · ${n} · ${reason}`);
    lines.push('', `Would send ${s.wouldSend} request${s.wouldSend === 1 ? '' : 's'} (cap ${s.cap}). Add --live to judge them.`);
    return lines.join('\n');
  }
  const shown = report.results.filter(r => r.outcome?.action === 'show');
  if (shown.length === 0) lines.push('  Nothing to show.');
  for (const r of shown) {
    lines.push(`${String(r.rank).padStart(3)}  ${r.outcome.score.toFixed(2)}  ${r.label}   ${r.title}`);
    lines.push(`           ${r.outcome.reason}${r.tags?.length ? `   [${r.tags.join(', ')}]` : ''}${r.provenance === 'seen-store' ? '   (seen)' : ''}`);
    lines.push(`           ${r.url}`);
  }
  const ask = report.results.filter(r => r.outcome?.action === 'needs-more-info');
  if (ask.length) {
    lines.push('', `Needs more info (${ask.length})`);
    for (const r of ask) lines.push(`     ${r.label}   ${r.title} — ${r.outcome.reason}`);
  }
  const hidden = report.results.filter(r => r.outcome?.action === 'hide');
  lines.push('', `Hidden: ${hidden.filter(r => r.provenance !== 'deterministic-preflight-no-model-call').length} judged, ${s.preflight} by preflight. Use --json for reasons.`);
  lines.push(`${s.judged} request${s.judged === 1 ? '' : 's'} · ${s.inputTokens.toLocaleString('en-US')} input tokens · est. ${money(s.estimatedCostUsd)} (${report.requestedModel} price snapshot ${DOCS_VERIFIED_ON}) · ${seconds(s.elapsedMs)}`);
  if (seenFile) lines.push(`Seen store: ${seenFile} (${s.judged} verdicts added)`);
  if (report.errors.length) lines.push('', `Stopped early: ${report.errors[0]}`);
  return lines.join('\n');
}

function countBy(rows, keyOf) {
  const m = new Map();
  for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
