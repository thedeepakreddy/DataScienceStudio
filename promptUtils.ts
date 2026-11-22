/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Small prompts answer better, especially on the small free models ARC routes to.
// compactJson() turns the facts a prompt carries into short JSON without losing
// what matters: no empty fields, numbers to 4 significant digits, long text and
// long lists shortened (and marked), no pretty-printing, and a hard size cap.

function shrink(v: unknown, depth: number, opts: { list: number; text: number }): unknown {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) && Math.abs(v) < 1e15 ? v : Number(v.toPrecision(4))) : undefined;
  if (typeof v === 'string') return v.length > opts.text ? `${v.slice(0, opts.text)}…` : v;
  if (typeof v === 'boolean') return v;
  if (depth > 6) return undefined;
  if (Array.isArray(v)) {
    const items = v.slice(0, opts.list).map(x => shrink(x, depth + 1, opts)).filter(x => x !== undefined);
    return v.length > opts.list ? [...items, `… ${v.length - opts.list} more`] : items;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const s = shrink(x, depth + 1, opts);
      if (s !== undefined && !(Array.isArray(s) && s.length === 0) && !(typeof s === 'object' && s && !Array.isArray(s) && Object.keys(s).length === 0)) out[k] = s;
    }
    return out;
  }
  return undefined;
}

/** Facts as compact JSON for a prompt, at most `maxChars` long (lists and text shorten first). */
export function compactJson(value: unknown, maxChars = 4000): string {
  for (const opts of [{ list: 40, text: 160 }, { list: 20, text: 100 }, { list: 10, text: 60 }, { list: 5, text: 40 }]) {
    const s = JSON.stringify(shrink(value, 0, opts) ?? null);
    if (s.length <= maxChars) return s;
  }
  const s = JSON.stringify(shrink(value, 0, { list: 3, text: 30 }) ?? null);
  return s.length <= maxChars ? s : `${s.slice(0, maxChars - 14)}… (shortened)`;
}
