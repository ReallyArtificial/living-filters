// A deliberately small YAML subset, enough for .filter.yaml files and nothing more.
// Supported: 2-space indented maps, block lists of scalars or one-level maps, inline [a, b] lists,
// `key: |` literal blocks, quoted or plain scalars, # comments. Everything else throws with a line number.

const fail = (name, line, message) => { throw new Error(`${name}:${line}: ${message}`); };

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function inlineList(name, line, body) {
  const inner = body.slice(1, -1).trim();
  if (inner.includes('[') || inner.includes('{')) fail(name, line, 'nested inline collections are not supported');
  return inner === '' ? [] : inner.split(',').map(scalar);
}

function splitKey(name, line, text) {
  const m = /^([^:\s][^:]*?)\s*:(?:\s+(.*)|$)/.exec(text);
  if (!m) fail(name, line, `expected "key: value", got "${text.trim()}"`);
  return [m[1].trim(), m[2] ?? ''];
}

export function parseYaml(text, name = 'filter.yaml') {
  const rows = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.includes('\t')) fail(name, line, 'tabs are not allowed; use two spaces');
    if (raw.trim() === '---' || raw.trim() === '...') fail(name, line, 'multi-document markers are not supported');
    rows.push({ line, raw, text: stripComment(raw), indent: raw.length - raw.trimStart().length });
  });
  const isBlank = (r) => r.text.trim() === '';

  // Literal block: lines after `key: |` that are indented deeper than the key.
  function literal(start, keyIndent) {
    const body = [];
    let j = start;
    for (; j < rows.length; j++) {
      const r = rows[j];
      if (r.raw.trim() === '') { body.push(''); continue; }
      if (r.indent <= keyIndent) break;
      body.push(r.raw);
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    const common = Math.min(...body.filter(Boolean).map(l => l.length - l.trimStart().length));
    return [body.map(l => l === '' ? '' : l.slice(common)).join('\n'), j];
  }

  function value(rowIndex, keyIndent, rawValue) {
    const r = rows[rowIndex];
    const v = rawValue.trim();
    if (v === '|') return literal(rowIndex + 1, keyIndent);
    if (v === '>') fail(name, r.line, 'folded blocks (>) are not supported; use |');
    if (v.startsWith('[')) {
      if (!v.endsWith(']')) fail(name, r.line, 'inline list must close on the same line');
      return [inlineList(name, r.line, v), rowIndex + 1];
    }
    if (v.startsWith('{')) fail(name, r.line, 'inline maps ({}) are not supported');
    if (v.startsWith('&') || v.startsWith('*')) fail(name, r.line, 'anchors and aliases are not supported');
    if (v !== '') return [scalar(v), rowIndex + 1];
    // Nested block on the following lines.
    let j = rowIndex + 1;
    while (j < rows.length && isBlank(rows[j])) j++;
    if (j >= rows.length || rows[j].indent <= keyIndent) return [null, rowIndex + 1];
    return block(j, rows[j].indent);
  }

  function block(start, indent) {
    const first = rows[start].text.trim();
    return first.startsWith('- ') || first === '-' ? list(start, indent) : map(start, indent);
  }

  function map(start, indent) {
    const out = {};
    let i = start;
    while (i < rows.length) {
      const r = rows[i];
      if (isBlank(r)) { i++; continue; }
      if (r.indent < indent) break;
      if (r.indent > indent) fail(name, r.line, `unexpected indentation (expected ${indent} spaces)`);
      if (r.text.trim().startsWith('- ')) fail(name, r.line, 'list item where a key was expected');
      const [key, rest] = splitKey(name, r.line, r.text.trim());
      if (key in out) fail(name, r.line, `duplicate key "${key}"`);
      const [v, next] = value(i, indent, rest);
      out[key] = v;
      i = next;
    }
    return [out, i];
  }

  function list(start, indent) {
    const out = [];
    let i = start;
    while (i < rows.length) {
      const r = rows[i];
      if (isBlank(r)) { i++; continue; }
      if (r.indent < indent) break;
      if (r.indent > indent) fail(name, r.line, `unexpected indentation (expected ${indent} spaces)`);
      const t = r.text.trim();
      if (!(t.startsWith('- ') || t === '-')) break;
      const body = t.slice(1).trim();
      if (/^[^:\s][^:]*?\s*:(\s|$)/.test(body) && !body.startsWith('[') && !body.startsWith('"') && !body.startsWith("'")) {
        // `- key: value` starts a one-level map; further keys sit at indent + 2.
        const [key, rest] = splitKey(name, r.line, body);
        const item = {};
        const [v, next] = value(i, indent + 2, rest);
        item[key] = v;
        let j = next;
        if (j < rows.length && !isBlank(rows[j]) && rows[j].indent === indent + 2 && !rows[j].text.trim().startsWith('- ')) {
          const [more, after] = map(j, indent + 2);
          Object.assign(item, more);
          j = after;
        }
        out.push(item);
        i = j;
      } else {
        const [v, next] = value(i, indent, body);
        out.push(v);
        i = next;
      }
    }
    return [out, i];
  }

  let start = 0;
  while (start < rows.length && isBlank(rows[start])) start++;
  if (start >= rows.length) return {};
  if (rows[start].indent !== 0) fail(name, rows[start].line, 'top level must not be indented');
  const [result, end] = map(start, 0);
  for (let i = end; i < rows.length; i++) if (!isBlank(rows[i])) fail(name, rows[i].line, 'unexpected content after the document');
  return result;
}
