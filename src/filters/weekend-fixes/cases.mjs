// Authored teaching cases and illustrative responses. These are not API recordings.
import { choice, score } from '../../fixtures.mjs';

export const config = {
  hours: 8,
  profile: 'Comfortable in TypeScript and Node; rusty Python; no Rust or Go.\nAbout eight focused hours. Prefers code over docs.',
  preflight: { skip_labels: ['wontfix', 'in progress'], skip_assigned: true, stale_days: 365, max_body_chars: 1500 },
  limits: { max_judgments: 25 },
};

const issue = (over = {}) => ({
  repo: 'acme/widgets', language: 'TypeScript', number: 12,
  title: 'Add --json flag to `widgets list`',
  body: 'Currently `widgets list` prints a table. Add `--json` printing the same rows as an array. Tests live in test/list.test.ts.',
  labels: ['good first issue'], assignees: 0, comments: 2,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  html_url: 'https://github.com/acme/widgets/issues/12',
  ...over,
});

const clearScope = score({ 0: 0, 1: 0, 2: 0, 3: 1 });
const smallEffort = choice({ under_4h: 0.9, hours_4_12: 0.1, days: 0, unknowable: 0 });

export default [
  {
    id: 'small-clear-fit', note: 'A scoped CLI flag in the profile\'s language, with a pointer to the tests.',
    item: issue(),
    fixture: { scope: clearScope, effort: smallEffort, fit: 0.95 },
    expected: 'show', expectedDetails: { score: 0.95 },
  },
  {
    id: 'wrong-language', note: 'The same shape of task in a language the profile rules out.',
    item: issue({ number: 13, language: 'Rust', title: 'Add --json flag to `widgets list` (Rust port)', html_url: 'https://github.com/acme/widgets/issues/13' }),
    fixture: { scope: clearScope, effort: smallEffort, fit: 0.1 },
    expected: 'hide',
  },
  {
    id: 'uncertain-effort', note: 'Confident scope but an unconfident effort estimate: ask, do not hide.',
    item: issue({ number: 14, html_url: 'https://github.com/acme/widgets/issues/14' }),
    fixture: { scope: clearScope, effort: choice({ under_4h: 0.4, hours_4_12: 0.4, days: 0.2, unknowable: 0 }, 0.4), fit: 0.9 },
    expected: 'needs-more-info',
  },
  {
    id: 'multi-day-refactor', note: 'A perfect fit that is a week of work.',
    item: issue({ number: 15, title: 'Replace the storage layer with SQLite', body: 'Migrate all persistence from JSON files to SQLite, with a migration path for existing users and no downtime. Keep the public API unchanged.', html_url: 'https://github.com/acme/widgets/issues/15' }),
    fixture: { scope: score({ 0: 0, 1: 0.2, 2: 0.8, 3: 0 }), effort: choice({ under_4h: 0, hours_4_12: 0.05, days: 0.95, unknowable: 0 }), fit: 0.9 },
    expected: 'hide',
  },
  {
    id: 'assigned-already', note: 'Assigned issues stop at preflight; no request exists.',
    item: issue({ number: 16, assignees: 1, html_url: 'https://github.com/acme/widgets/issues/16' }),
    fixture: {},
    expected: 'hide',
  },
];
