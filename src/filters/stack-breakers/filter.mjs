import { choice, score, noul, no, confident, decision } from '../../questions.mjs';
import { compareVersions } from '../../semver.mjs';
import { fetchReleases } from '../../github.mjs';
import cases, { config as caseConfig } from './cases.mjs';

const AFFECTS_NO = 0.2;
const BREAKING_KEYWORDS = /break|deprecat|remov|migrat|drop/i;
const BUMP_WEIGHT = { major: 1, minor: 0.8, patch: 0.6 };
const MIGRATION_LABEL = ['trivial migration', 'moderate migration', 'substantial migration'];
const round3 = (n) => Math.round(n * 1000) / 1000;

export default {
  kind: 'stack-breakers',
  summary: 'Releases of your package.json dependencies whose notes suggest a break for the stack you describe.',
  defaults: {
    preflight: { skip_prerelease: true, patch_needs_keyword: true, max_per_package: 3, max_body_chars: 2500 },
    limits: { max_judgments: 25 },
  },
  validateConfig(config, file = 'filter') {
    if (typeof config.stack !== 'string' || !config.stack.trim()) throw new Error(`${file}: "stack" must describe what this project uses (use a | block)`);
    if (typeof config.project !== 'string') throw new Error(`${file}: "project" must be a directory containing package.json`);
  },
  fetch: (config, gh) => fetchReleases(config.project, {
    includeDev: config.include_dev === true, maxPerPackage: config.preflight.max_per_package,
    maxBodyChars: config.preflight.max_body_chars, ghGet: gh.ghGet, npmGet: gh.npmGet,
  }),
  key: (item) => `${item.name}@${item.tag}`,
  label: (item) => `${item.name} ${item.installed} → ${item.version}`,
  title: (item) => item.title,
  url: (item) => item.html_url,
  tags: (item) => [item.bump],
  preflight(config, item) {
    const p = config.preflight;
    if (item.prerelease && p.skip_prerelease) return decision('hide', 'Pre-release.', { score: 0 });
    if (compareVersions(item.version, item.installed) <= 0) return decision('hide', 'Not newer than the installed version.', { score: 0 });
    if (item.bump === 'patch' && p.patch_needs_keyword && !BREAKING_KEYWORDS.test(item.body)) return decision('hide', 'Patch release without breaking keywords.', { score: 0 });
    if (item.body.trim().length < 20) return decision('needs-more-info', 'No release notes; open the compare view.', { score: 0.05 });
  },
  state: (config, item) => ({
    stack: config.stack,
    package: { name: item.name, installed: item.installed },
    release: { tag: item.tag, bump: item.bump, title: item.title, published_at: item.published_at, body: item.body },
  }),
  questions: () => ({
    breaks: choice('Do the release notes in `release.body` describe a change that would require code, configuration, or runtime changes when upgrading `package.name` from `package.installed` to `release.tag`? Judge only from the notes; `release.bump` is the semver bump kind.', {
      breaking_documented: 'The notes explicitly describe removed or changed public APIs, defaults, behavior, or supported runtimes.',
      behavior_change: 'The notes describe changed behavior that is not labelled breaking but could affect callers.',
      additive: 'The notes describe only additions, fixes, performance, or internal changes.',
      unclear: 'The notes are empty, an auto-generated commit list, or otherwise insufficient to tell.',
    }),
    affects_stack: noul('Given the description in `stack`, is it likely that the changes described in `release.body` touch functionality this stack uses from `package.name`? Answer near the middle if `stack` does not say.'),
    migration_effort: score('If the changes described in `release.body` applied to a caller of `package.name`, how much work do the notes suggest a migration would be?', [
      'Trivial: a rename or a version bump.',
      'Moderate: a documented migration guide or several call sites.',
      'Substantial: a rewrite of an integration, or no migration path is given.',
    ]),
  }),
  decide(s, a) {
    if (!confident(a.breaks)) return decision('needs-more-info', 'Could not tell from the notes.', { score: 0.2 });
    if (a.breaks.choice === 'unclear') return decision('needs-more-info', 'Notes do not describe the change; read the changelog or diff.', { score: 0.1 });
    if (a.breaks.choice === 'additive') return decision('hide', 'Additive or internal release.', { score: 0 });
    if (no(a.affects_stack, AFFECTS_NO)) return decision('hide', 'Breaking, but in functionality this stack does not use.', { score: 0 });
    const severity = a.breaks.choice === 'breaking_documented' ? 1 : 0.6;
    const effort = confident(a.migration_effort) ? MIGRATION_LABEL[Math.round(a.migration_effort.score)] : 'migration effort unclear';
    const kind = a.breaks.choice === 'breaking_documented' ? 'documented breaking change' : 'behavior change';
    return decision('show', `${s.release.bump} bump, ${kind}; ${effort}.`, { score: round3(severity * Math.max(a.affects_stack.noul, 0.5) * (BUMP_WEIGHT[s.release.bump] ?? 0.6)) });
  },
  cases, caseConfig,
};
