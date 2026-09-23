import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, bumpKind, versionFromTag } from '../src/semver.mjs';

test('parseVersion strips a leading v and flags prereleases', () => {
  assert.deepEqual(parseVersion('v4.6.5'), { major: 4, minor: 6, patch: 5, prerelease: null, version: '4.6.5' });
  assert.equal(parseVersion('4.0.0-beta.1').prerelease, 'beta.1');
  assert.equal(parseVersion('4.0.0-beta.1').version, '4.0.0-beta.1');
  assert.equal(parseVersion('^4.0.0'), null);
  assert.equal(parseVersion('4.0'), null);
});

test('compareVersions orders by major, then minor, then patch', () => {
  assert.equal(compareVersions('3.25.76', '4.0.0'), -1);
  assert.equal(compareVersions('4.0.0', '3.25.76'), 1);
  assert.equal(compareVersions('4.3.19', '4.3.19'), 0);
  assert.equal(compareVersions('4.10.0', '4.9.9'), 1);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
});

test('bumpKind names the bump and returns null when not newer', () => {
  assert.equal(bumpKind('3.25.76', '4.0.0'), 'major');
  assert.equal(bumpKind('4.3.19', '4.4.0'), 'minor');
  assert.equal(bumpKind('4.3.19', '4.3.20'), 'patch');
  assert.equal(bumpKind('4.3.19', '4.3.19'), null);
  assert.equal(bumpKind('7.0.111', '6.9.0'), null);
});

test('versionFromTag handles plain, v-prefixed and monorepo tags', () => {
  assert.equal(versionFromTag('v4.6.5', 'zod').version, '4.6.5');
  assert.equal(versionFromTag('4.6.5', 'zod').version, '4.6.5');
  assert.equal(versionFromTag('ai@7.0.111', 'ai').version, '7.0.111');
  assert.equal(versionFromTag('@ai-sdk/openai@2.0.42', '@ai-sdk/openai').version, '2.0.42');
  assert.equal(versionFromTag('@ai-sdk/workflow@2.0.42', 'ai'), null);
  assert.equal(versionFromTag('ai@7.0.111', '@ai-sdk/openai'), null);
  assert.equal(versionFromTag('release-2026-09', 'zod'), null);
  assert.equal(versionFromTag('v4.0.0-beta.1', 'zod').prerelease, 'beta.1');
});
