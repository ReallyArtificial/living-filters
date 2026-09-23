// Authored teaching cases and illustrative responses. These are not API recordings.
import { choice, score } from '../../fixtures.mjs';

export const config = {
  project: '.',
  stack: 'Node 20 ESM service. better-sqlite3 for storage, the MCP SDK for a stdio server, zod v3 schemas at every boundary, chrono-node for date parsing.',
  preflight: { skip_prerelease: true, patch_needs_keyword: true, max_per_package: 3, max_body_chars: 2500 },
  limits: { max_judgments: 25 },
};

const release = (over = {}) => ({
  name: 'zod', installed: '3.25.76', repo: 'colinhacks/zod', tag: 'v4.0.0', version: '4.0.0', bump: 'major', prerelease: false,
  title: 'Zod 4',
  body: '## Breaking changes\n- `z.string().email()` and friends are removed; use the top-level `z.email()`.\n- The error map API is replaced by `z.config({ customError })`.\n- `.default()` now short-circuits parsing and must be the output type.\nSee the migration guide for every change.',
  published_at: '2026-07-01T00:00:00Z', html_url: 'https://github.com/colinhacks/zod/releases/tag/v4.0.0',
  ...over,
});

const documented = choice({ breaking_documented: 0.95, behavior_change: 0.05, additive: 0, unclear: 0 });

export default [
  {
    id: 'major-documented-breaking', note: 'A major with explicit removals in a library the stack uses everywhere.',
    item: release(),
    fixture: { breaks: documented, affects_stack: 0.95, migration_effort: score({ 0: 0, 1: 0.8, 2: 0.2 }) },
    expected: 'show', expectedDetails: { score: 0.95 },
  },
  {
    id: 'minor-additive', note: 'A minor that only adds an option and fixes a bug.',
    item: release({ name: 'ai', installed: '4.3.19', repo: 'vercel/ai', tag: 'ai@4.4.0', version: '4.4.0', bump: 'minor', title: 'ai@4.4.0', body: 'Adds an `experimental_telemetry` option to `generateText`. Fixes a streaming edge case when the provider closes early.', html_url: 'https://github.com/vercel/ai/releases/tag/ai%404.4.0' }),
    fixture: { breaks: choice({ breaking_documented: 0, behavior_change: 0.1, additive: 0.9, unclear: 0 }), affects_stack: 0.6, migration_effort: score({ 0: 1, 1: 0, 2: 0 }) },
    expected: 'hide',
  },
  {
    id: 'patch-without-keyword', note: 'A patch whose notes mention nothing breaking stops at preflight; no request exists.',
    item: release({ name: 'better-sqlite3', installed: '11.5.0', repo: 'WiseLibs/better-sqlite3', tag: 'v11.5.1', version: '11.5.1', bump: 'patch', title: 'v11.5.1', body: 'Fix the prebuilt binary download on macOS with Node 22.1.', html_url: 'https://github.com/WiseLibs/better-sqlite3/releases/tag/v11.5.1' }),
    fixture: {},
    expected: 'hide',
  },
  {
    id: 'patch-breaking-not-our-usage', note: 'Documented breaking change in a part of the package this stack does not touch.',
    item: release({ name: 'chrono-node', installed: '2.7.5', repo: 'wanasit/chrono', tag: 'v2.7.6', version: '2.7.6', bump: 'patch', title: 'v2.7.6', body: 'BREAKING: dropped Node 16 support. Removed the legacy `chrono.casual.ja` locale export; import from `chrono-node/ja` instead.', html_url: 'https://github.com/wanasit/chrono/releases/tag/v2.7.6' }),
    fixture: { breaks: choice({ breaking_documented: 0.9, behavior_change: 0.1, additive: 0, unclear: 0 }), affects_stack: 0.05, migration_effort: score({ 0: 0.9, 1: 0.1, 2: 0 }) },
    expected: 'hide',
  },
  {
    id: 'auto-generated-changelog', note: 'A commit list says nothing about the change; ask for a real changelog instead of guessing.',
    item: release({ name: '@modelcontextprotocol/sdk', installed: '1.20.0', repo: 'modelcontextprotocol/typescript-sdk', tag: '1.21.0', version: '1.21.0', bump: 'minor', title: '1.21.0', body: "## What's Changed\n* chore: bump dependencies by @bot in #612\n* fix: typo in README by @someone in #615\n\n**Full Changelog**: https://github.com/modelcontextprotocol/typescript-sdk/compare/1.20.0...1.21.0", html_url: 'https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.21.0' }),
    fixture: { breaks: choice({ breaking_documented: 0.05, behavior_change: 0.1, additive: 0, unclear: 0.85 }), affects_stack: 0.5, migration_effort: score({ 0: 0.4, 1: 0.4, 2: 0.2 }, 0.3) },
    expected: 'needs-more-info',
  },
  {
    id: 'not-newer', note: 'A tag equal to the installed version stops at preflight.',
    item: release({ tag: 'v3.25.76', version: '3.25.76', bump: 'none', title: 'v3.25.76', html_url: 'https://github.com/colinhacks/zod/releases/tag/v3.25.76' }),
    fixture: {},
    expected: 'hide',
  },
];
