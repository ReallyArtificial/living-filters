import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVersion, compareVersions, bumpKind, versionFromTag } from './semver.mjs';

export function githubToken() {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (token) return token;
  } catch { /* gh missing or logged out */ }
  return null;
}

export function makeGhGet({ token = null, fetchImpl = globalThis.fetch } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'living-filters' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, { headers });
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      throw new Error(`GitHub HTTP ${res.status} for ${path}${remaining !== null ? ` (rate limit remaining: ${remaining})` : ''}`);
    }
    return res.json();
  };
}

export function makeNpmGet({ fetchImpl = globalThis.fetch } = {}) {
  return async (name) => {
    const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : name;
    const res = await fetchImpl(`https://registry.npmjs.org/${encoded}`, { headers: { Accept: 'application/json', 'User-Agent': 'living-filters' } });
    if (!res.ok) throw new Error(`npm registry HTTP ${res.status} for ${name}`);
    return res.json();
  };
}

export const truncate = (text, max) => {
  const s = String(text ?? '').replace(/\r\n/g, '\n').trim();
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s;
};

export const issueItem = (repo, language, raw, maxBodyChars) => ({
  repo, language, number: raw.number, title: raw.title, body: truncate(raw.body, maxBodyChars),
  labels: (raw.labels ?? []).map(l => typeof l === 'string' ? l : l.name), assignees: (raw.assignees ?? []).length,
  comments: raw.comments ?? 0, created_at: raw.created_at, updated_at: raw.updated_at, html_url: raw.html_url,
});

export async function fetchIssues(repos, { maxBodyChars, ghGet }) {
  const items = [];
  for (const repo of repos) {
    const meta = await ghGet(`/repos/${repo}`);
    const raw = await ghGet(`/repos/${repo}/issues?state=open&per_page=50`);
    for (const r of raw) if (!r.pull_request) items.push(issueItem(repo, meta.language ?? null, r, maxBodyChars));
  }
  return items;
}

export function readDependencies(dir, includeDev) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return Object.keys({ ...(pkg.dependencies ?? {}), ...(includeDev ? pkg.devDependencies ?? {} : {}) });
}

// package-lock v2/v3 keeps packages by path; v1 keeps a dependencies tree.
export const installedFromLock = (lock, name) => lock?.packages?.[`node_modules/${name}`]?.version ?? lock?.dependencies?.[name]?.version ?? null;

export function installedVersion(dir, name) {
  const installed = join(dir, 'node_modules', name, 'package.json');
  if (existsSync(installed)) return JSON.parse(readFileSync(installed, 'utf8')).version ?? null;
  const lock = join(dir, 'package-lock.json');
  if (existsSync(lock)) return installedFromLock(JSON.parse(readFileSync(lock, 'utf8')), name);
  return null;
}

export function repoFromRegistry(doc) {
  const url = typeof doc?.repository === 'string' ? doc.repository : doc?.repository?.url;
  const m = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[/#].*)?$/.exec(url ?? '');
  if (!m) return null;
  return { owner: m[1], repo: m[2], monorepo: Boolean(doc.repository?.directory) };
}

export function releaseItem(name, installed, repo, raw, maxBodyChars) {
  const v = versionFromTag(raw.tag_name, name);
  if (!v) return null;
  return {
    name, installed, repo, tag: raw.tag_name, version: v.version, bump: bumpKind(installed, v.version) ?? 'none',
    prerelease: Boolean(raw.prerelease || v.prerelease), title: raw.name || raw.tag_name, body: truncate(raw.body, maxBodyChars),
    published_at: raw.published_at, html_url: raw.html_url,
  };
}

export async function fetchReleases(dir, { includeDev, maxPerPackage, maxBodyChars, ghGet, npmGet, log = (m) => console.error(m) }) {
  const items = [];
  for (const name of readDependencies(dir, includeDev)) {
    const installed = installedVersion(dir, name);
    if (!installed || !parseVersion(installed)) { log(`  skip ${name}: installed version unknown (no node_modules entry or lockfile)`); continue; }
    const repo = repoFromRegistry(await npmGet(name));
    if (!repo) { log(`  skip ${name}: npm registry entry has no GitHub repository`); continue; }
    const raw = await ghGet(`/repos/${repo.owner}/${repo.repo}/releases?per_page=${repo.monorepo ? 50 : 10}`);
    const newer = raw.filter(r => !r.draft)
      .map(r => releaseItem(name, installed, `${repo.owner}/${repo.repo}`, r, maxBodyChars))
      .filter(r => r && compareVersions(r.version, installed) > 0)
      .sort((a, b) => compareVersions(b.version, a.version))
      .slice(0, maxPerPackage);
    items.push(...newer);
  }
  return items;
}
