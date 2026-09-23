import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseYaml } from './yaml.mjs';
import { filters } from './filters/index.mjs';

export function loadFilter(path) {
  const file = resolve(path);
  const config = parseYaml(readFileSync(file, 'utf8'), path);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(config.name ?? ''))) throw new Error(`${path}: "name" must be a lowercase slug such as weekend-fixes`);
  const filter = filters[config.kind];
  if (!filter) throw new Error(`${path}: unknown kind "${config.kind}". Known kinds: ${Object.keys(filters).join(', ')}`);
  config.preflight = { ...filter.defaults.preflight, ...(config.preflight ?? {}) };
  config.limits = { ...filter.defaults.limits, ...(config.limits ?? {}) };
  if (filter.kind === 'stack-breakers') config.project = resolve(dirname(file), config.project ?? '.');
  filter.validateConfig(config, path);
  return { filter, config, file };
}

// A bare kind name selects the bundled filter with its authored cases; a path loads a shareable config.
export function resolveFilter(arg) {
  if (filters[arg]) return { filter: filters[arg], config: null, file: null };
  if (!arg.endsWith('.yaml') && !arg.endsWith('.yml')) throw new Error(`Unknown filter "${arg}". Use a kind (${Object.keys(filters).join(', ')}) or a .filter.yaml path.`);
  return loadFilter(arg);
}
