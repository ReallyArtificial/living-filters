import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const seenDir = () => join(process.env.LIVING_FILTERS_HOME?.trim() || join(homedir(), '.living-filters'), 'seen');
export const seenPath = (name) => join(seenDir(), `${name}.json`);

export function loadSeen(name) {
  const path = seenPath(name);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')).verdicts ?? {};
}

export function saveSeen(name, verdicts) {
  mkdirSync(seenDir(), { recursive: true });
  writeFileSync(seenPath(name), `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), verdicts }, null, 2)}\n`, { mode: 0o600 });
  return seenPath(name);
}
