#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { DEFAULT_MODEL } from './client.mjs';
import { filters } from './filters/index.mjs';
import { resolveFilter, loadFilter } from './config.mjs';
import { prepare, runCases, runFilter } from './runner.mjs';
import { loadSeen, saveSeen } from './seen.mjs';
import { githubToken, makeGhGet, makeNpmGet } from './github.mjs';
import { casesReport, formatCases, runReport, formatRun } from './report.mjs';

const root = new URL('../', import.meta.url);
const BOOL = new Set(['live', 'all', 'json', 'check', 'help']), VALUE = new Set(['case', 'model', 'limit', 'out']);
const USAGE = `living-filters: describe what deserves your attention.

  lf list
  lf cases <kind|file.filter.yaml> [--check] [--json] [--live]
  lf request <kind|file.filter.yaml> --case ID [--model ID]
  lf run <file.filter.yaml> [--live] [--all] [--limit N] [--model ID] [--json] [--out FILE]

Kinds: ${Object.keys(filters).join(', ')}
Only --live calls the TypeSafe API (needs TYPESAFE_API_KEY in .env). Without it, run is a dry run.`;

function parse(argv) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const name = arg.slice(2);
    if (name in flags) throw new Error(`Repeated flag --${name}`);
    if (BOOL.has(name)) flags[name] = true;
    else if (VALUE.has(name)) { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`); flags[name] = argv[++i]; }
    else throw new Error(`Unknown flag --${name}`);
  }
  return { command: positional[0], args: positional.slice(1), flags };
}

function writeOut(path, report) {
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function requireKey(flags) {
  if (existsSync(new URL('.env', root))) loadEnvFile(fileURLToPath(new URL('.env', root)));
  if (flags.live && !process.env.TYPESAFE_API_KEY?.trim()) throw new Error('Set TYPESAFE_API_KEY in .env (copy .env.example) before using --live.');
  return flags.model ?? (process.env.JEV_MODEL?.trim() || DEFAULT_MODEL);
}

async function main() {
  const { command, args, flags } = parse(process.argv.slice(2));
  if (!command || flags.help || command === '--help') { console.log(USAGE); return; }

  if (command === 'list') {
    for (const f of Object.values(filters)) console.log(`${f.kind.padEnd(16)} ${f.summary}  (${f.cases.length} authored cases)`);
    const dir = new URL('filters/', root);
    const files = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.filter.yaml')) : [];
    if (files.length) { console.log('\nShipped configs:'); for (const n of files) console.log(`  filters/${n}`); }
    return;
  }

  if (command === 'cases') {
    if (args.length !== 1) throw new Error('cases needs one kind or .filter.yaml path');
    const { filter } = resolveFilter(args[0]);
    const model = flags.live ? requireKey(flags) : (flags.model ?? DEFAULT_MODEL);
    const report = casesReport(filter, await runCases(filter, { live: Boolean(flags.live), model }), { mode: flags.live ? 'live' : 'fixture', model });
    if (flags.out) writeOut(flags.out, report);
    console.log(flags.json ? JSON.stringify(report, null, 2) : formatCases(filter, report));
    if (flags.check && report.summary.matchesExpected !== report.summary.cases) process.exitCode = 1;
    return;
  }

  if (command === 'request') {
    if (args.length !== 1 || !flags.case) throw new Error('request needs a kind or .filter.yaml path and --case ID');
    const { filter } = resolveFilter(args[0]);
    const c = filter.cases.find(x => x.id === flags.case);
    if (!c) throw new Error(`No case "${flags.case}" in ${filter.kind}. Cases: ${filter.cases.map(x => x.id).join(', ')}`);
    const model = requireKey({ ...flags, live: false });
    const { preflight, request } = prepare(filter, filter.caseConfig, c.item, model);
    console.log(JSON.stringify({ kind: filter.kind, case: c.id, preflight, request }, null, 2));
    return;
  }

  if (command === 'run') {
    if (args.length !== 1) throw new Error('run needs one .filter.yaml path');
    const { filter, config, file } = loadFilter(args[0]);
    const live = Boolean(flags.live);
    const model = live ? requireKey(flags) : (flags.model ?? DEFAULT_MODEL);
    const limit = flags.limit ? Number(flags.limit) : config.limits.max_judgments;
    if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit must be a non-negative integer');
    if (flags.out && existsSync(flags.out)) throw new Error(`Refusing to overwrite ${flags.out}`);
    const token = githubToken();
    if (!token) console.error('No GitHub token found (GITHUB_TOKEN or `gh auth login`); unauthenticated requests are limited to 60 per hour.');
    const gh = { ghGet: makeGhGet({ token }), npmGet: makeNpmGet() };
    console.error(`Fetching ${filter.kind} items…`);
    const items = await filter.fetch(config, gh);
    const seen = live ? loadSeen(config.name) : {};
    const run = await runFilter(filter, config, items, { live, model, seen, all: Boolean(flags.all), limit, onProgress: (n, cap, label) => console.error(`  judging ${n}/${Math.min(cap, items.length)} · ${label}`) });
    const seenFile = live ? saveSeen(config.name, run.seen) : null;
    const report = runReport(filter, config, file, run, { mode: live ? 'live' : 'dry-run', model });
    if (flags.out) writeOut(flags.out, report);
    console.log(flags.json ? JSON.stringify(report, null, 2) : formatRun(filter, report, seenFile));
    if (run.error) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
