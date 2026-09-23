import { choice, score, noul, yes, no, confident, decision } from '../../questions.mjs';
import { fetchIssues } from '../../github.mjs';
import cases, { config as caseConfig } from './cases.mjs';

// Thresholds are teaching policies, not measured guarantees.
const FIT_YES = 0.7, FIT_NO = 0.3;
const EFFORT_LABEL = { under_4h: 'under four hours', hours_4_12: 'four to twelve hours', days: 'multiple days', unknowable: 'effort unknowable' };
const SCOPE_LABEL = ['unclear ask', 'no acceptance criteria', 'implied acceptance criteria', 'explicit acceptance criteria'];
const round3 = (n) => Math.round(n * 1000) / 1000;
const daysAgo = (iso) => (Date.now() - Date.parse(iso)) / 86_400_000;

export default {
  kind: 'weekend-fixes',
  summary: 'Open GitHub issues you could plausibly fix in one weekend, given a short profile.',
  defaults: {
    preflight: { skip_labels: ['wontfix', 'duplicate', 'invalid', 'in progress', 'blocked'], skip_assigned: true, stale_days: 365, max_body_chars: 1500 },
    limits: { max_judgments: 25 },
  },
  validateConfig(config, file = 'filter') {
    if (!Array.isArray(config.repos) || config.repos.length === 0 || !config.repos.every(r => /^[\w.-]+\/[\w.-]+$/.test(r))) throw new Error(`${file}: "repos" must be a non-empty list of owner/name`);
    if (typeof config.profile !== 'string' || !config.profile.trim()) throw new Error(`${file}: "profile" must describe the person (use a | block)`);
    if (typeof config.hours !== 'number' || config.hours <= 0) throw new Error(`${file}: "hours" must be a positive number`);
  },
  fetch: (config, gh) => fetchIssues(config.repos, { maxBodyChars: config.preflight.max_body_chars, ghGet: gh.ghGet }),
  key: (item) => `${item.repo}#${item.number}@${item.updated_at}`,
  label: (item) => `${item.repo}#${item.number}`,
  title: (item) => item.title,
  url: (item) => item.html_url,
  tags: (item) => item.labels,
  preflight(config, item) {
    const p = config.preflight;
    const skip = new Set(p.skip_labels.map(l => l.toLowerCase()));
    const hit = item.labels.find(l => skip.has(l.toLowerCase()));
    if (hit) return decision('hide', `Labelled \`${hit}\`.`, { score: 0 });
    if (p.skip_assigned && item.assignees > 0) return decision('hide', 'Already assigned.', { score: 0 });
    if (item.comments === 0 && daysAgo(item.updated_at) > p.stale_days) return decision('hide', `Unanswered for more than ${p.stale_days} days.`, { score: 0 });
    if (item.body.trim().length < 40) return decision('needs-more-info', 'No description to plan from.', { score: 0.05 });
  },
  state: (config, item) => ({
    profile: config.profile, hours: config.hours,
    issue: { repo: item.repo, language: item.language, title: item.title, body: item.body, labels: item.labels, comments: item.comments, created_at: item.created_at },
  }),
  questions: () => ({
    scope: score('Reading only `issue.title` and `issue.body`, how well specified is the work? Ignore who would do it.', [
      'Unclear what is being asked, or a maintainer decision is needed first.',
      'Direction is clear but there are no acceptance criteria.',
      'Clear ask with implied acceptance criteria.',
      'Clear ask with explicit acceptance criteria, reproduction steps, or a pointer to the code.',
    ]),
    effort: choice('Estimate the implementation effort for `issue` in repository `issue.repo` (primary language `issue.language`) for a competent contributor who is new to this codebase, judging from the issue text alone.', {
      under_4h: 'Under four hours: a localized change with an obvious test.',
      hours_4_12: 'Four to twelve hours: several files, a new test setup, or reading unfamiliar code.',
      days: 'Multiple days: a new subsystem, a design discussion, or a wide refactor.',
      unknowable: 'The issue text does not support an estimate.',
    }),
    fit: noul('Does the person described in `profile` have the skills and stated preferences to do the work described in `issue` without first learning a new language, framework, or platform? Consider `issue.language` and `issue.labels`.'),
  }),
  decide(s, a) {
    if (!confident(a.effort) || !confident(a.scope)) return decision('needs-more-info', 'Effort or scope judgment is not confident.', { score: 0.2 });
    if (a.effort.choice === 'unknowable' || a.scope.score < 1) return decision('needs-more-info', 'Issue text is too thin to plan a weekend around.', { score: 0.1 });
    if (a.effort.choice === 'days') return decision('hide', 'More than a weekend of work.', { score: 0 });
    if (a.effort.choice === 'hours_4_12' && s.hours < 4) return decision('hide', `Needs more than the ${s.hours}h available.`, { score: 0 });
    if (no(a.fit, FIT_NO)) return decision('hide', "Outside this profile's stack or stated preferences.", { score: 0 });
    if (!yes(a.fit, FIT_YES)) return decision('needs-more-info', 'Fit is unclear; skim the issue before committing.', { score: round3(a.fit.noul) });
    const effortWeight = a.effort.choice === 'under_4h' ? 1 : 0.7;
    return decision('show', `${EFFORT_LABEL[a.effort.choice]}; ${SCOPE_LABEL[Math.round(a.scope.score)]}.`, { score: round3(a.fit.noul * effortWeight * (0.5 + a.scope.score / 6)) });
  },
  cases, caseConfig,
};
