// Major.minor.patch only. Prerelease is flagged, not ordered.
const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text) {
  const m = RE.exec(String(text ?? '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null, version: `${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ''}` };
}

export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a, y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error(`Cannot compare versions ${a} and ${b}`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  return 0;
}

export function bumpKind(from, to) {
  const x = parseVersion(from), y = parseVersion(to);
  if (!x || !y || compareVersions(x, y) >= 0) return null;
  if (y.major !== x.major) return 'major';
  if (y.minor !== x.minor) return 'minor';
  return 'patch';
}

// Monorepos tag releases as `<package>@1.2.3`; a tag for another package returns null.
export function versionFromTag(tag, packageName) {
  let text = String(tag ?? '').trim();
  const at = text.lastIndexOf('@');
  if (at > 0) {
    if (text.slice(0, at) !== packageName) return null;
    text = text.slice(at + 1);
  }
  return parseVersion(text);
}
