import { describe, expect, it } from 'vitest';
import { compactJson } from '../../promptUtils';

describe('compact prompt facts', () => {
  it('drops empties, rounds numbers and keeps the facts', () => {
    expect(compactJson({ a: 1.23456789, b: null, c: '', d: [], e: { f: undefined }, g: 'ok', h: 42, i: true })).toBe('{"a":1.235,"g":"ok","h":42,"i":true}');
  });
  it('shortens long lists and text, and stays under the cap', () => {
    const big = { cols: Array.from({ length: 300 }, (_, i) => ({ name: `column_${i}`, mean: i / 3, note: 'x'.repeat(500) })) };
    const s = compactJson(big, 3000);
    expect(s.length).toBeLessThanOrEqual(3000);
    expect(s).toContain('more');
    expect(JSON.parse(s.endsWith('(shortened)') ? '{}' : s)).toBeTruthy();
  });
});
