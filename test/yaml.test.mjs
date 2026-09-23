import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYaml } from '../src/yaml.mjs';

test('scalars: booleans, integers, floats, quoted and plain strings, null', () => {
  const doc = parseYaml('a: true\nb: false\nc: 42\nd: -3\ne: 6.5\nf: "quoted # not a comment"\ng: \'single\'\nh: plain text with spaces\ni:\nj: ~\n');
  assert.deepEqual(doc, { a: true, b: false, c: 42, d: -3, e: 6.5, f: 'quoted # not a comment', g: 'single', h: 'plain text with spaces', i: null, j: null });
});

test('nested maps by indentation, two levels deep', () => {
  const doc = parseYaml('preflight:\n  skip_assigned: true\n  nested:\n    depth: 2\nlimits:\n  max_judgments: 25\n');
  assert.deepEqual(doc, { preflight: { skip_assigned: true, nested: { depth: 2 } }, limits: { max_judgments: 25 } });
});

test('block lists of scalars and of one-level maps', () => {
  const doc = parseYaml('repos:\n  - a/b\n  - c/d\nrules:\n  - id: one\n    weight: 2\n  - id: two\n');
  assert.deepEqual(doc, { repos: ['a/b', 'c/d'], rules: [{ id: 'one', weight: 2 }, { id: 'two' }] });
});

test('inline scalar lists, including quoted items with spaces', () => {
  assert.deepEqual(parseYaml('labels: [wontfix, "in progress", 3]\nempty: []\n'), { labels: ['wontfix', 'in progress', 3], empty: [] });
});

test('literal block keeps line breaks, strips common indent and trailing blank lines', () => {
  const doc = parseYaml('profile: |\n  Line one.\n  Line two, indented\n    more.\n\nnext: 1\n');
  assert.equal(doc.profile, 'Line one.\nLine two, indented\n  more.');
  assert.equal(doc.next, 1);
});

test('comments at line start and after whitespace are ignored; # inside quotes is kept', () => {
  const doc = parseYaml('# heading\na: 1   # trailing\nb: "x # y"\n');
  assert.deepEqual(doc, { a: 1, b: 'x # y' });
});

test('errors carry the file name and line number', () => {
  assert.throws(() => parseYaml('a: 1\n\tb: 2\n', 'f.yaml'), /^Error: f\.yaml:2: tabs/);
  assert.throws(() => parseYaml('a: {x: 1}\n', 'f.yaml'), /f\.yaml:1: inline maps/);
  assert.throws(() => parseYaml('a: >\n  folded\n', 'f.yaml'), /f\.yaml:1: folded/);
  assert.throws(() => parseYaml('a: 1\na: 2\n', 'f.yaml'), /f\.yaml:2: duplicate key "a"/);
  assert.throws(() => parseYaml('a:\n   b: 1\n  c: 2\n', 'f.yaml'), /f\.yaml:3: unexpected indentation/);
  assert.throws(() => parseYaml('---\na: 1\n', 'f.yaml'), /f\.yaml:1: multi-document/);
});

test('the shipped filter files parse to the expected objects', () => {
  const weekend = parseYaml(readFileSync(new URL('../filters/weekend-fixes.filter.yaml', import.meta.url), 'utf8'));
  assert.equal(weekend.kind, 'weekend-fixes');
  assert.deepEqual(weekend.repos, ['ReallyArtificial/freeport', 'ReallyArtificial/engram', 'ReallyArtificial/mcp-jest']);
  assert.equal(weekend.hours, 8);
  assert.match(weekend.profile, /^Comfortable in TypeScript and Node; rusty Python; no Rust or Go\.\nAbout eight/);
  assert.deepEqual(weekend.preflight, { skip_labels: ['wontfix', 'duplicate', 'invalid', 'in progress', 'blocked', 'needs discussion'], skip_assigned: true, stale_days: 365, max_body_chars: 1500 });
  assert.deepEqual(weekend.limits, { max_judgments: 25 });

  const stack = parseYaml(readFileSync(new URL('../filters/stack-breakers.filter.yaml', import.meta.url), 'utf8'));
  assert.equal(stack.kind, 'stack-breakers');
  assert.equal(stack.project, '../../engram');
  assert.equal(stack.include_dev, false);
  assert.match(stack.stack, /zod v3 schemas at every boundary/);
  assert.deepEqual(stack.preflight, { skip_prerelease: true, patch_needs_keyword: true, max_per_package: 3, max_body_chars: 2500 });
});
