import { describe, expect, it } from 'vitest';
import { cleanGeminiKey, isArcKey, keyKind, looksLikeGeminiKey } from './aiKey';

describe('Gemini key check', () => {
  it('accepts classic and newer AI Studio keys', () => {
    expect(looksLikeGeminiKey('AIzaSyA1234567890abcdefghijklmnopqrstuv')).toBe(true);
    expect(looksLikeGeminiKey('AQ.Ab8RN6Ij1234567890abcdefGHIJKLmnop_qrs-tuv')).toBe(true);
  });

  it('tidies what pasting adds', () => {
    expect(cleanGeminiKey(' "AIzaSyA1234567890abcdefghijklmnopqrstuv"\n')).toBe('AIzaSyA1234567890abcdefghijklmnopqrstuv');
    expect(cleanGeminiKey('GEMINI_API_KEY=AIzaSyA1234567890abcdefghijklmnopqrstuv')).toBe('AIzaSyA1234567890abcdefghijklmnopqrstuv');
    expect(cleanGeminiKey('AIzaSyA12345​67890abcdefghijklmnop')).toBe('AIzaSyA1234567890abcdefghijklmnop');
  });

  it('rejects text that is not a key', () => {
    expect(looksLikeGeminiKey('hello')).toBe(false);
    expect(looksLikeGeminiKey('my key is <secret>')).toBe(false);
  });
});

describe('ARC key check', () => {
  const arc = `ARC_DEE_${'a'.repeat(17)}_PAK_${'B'.repeat(43)}`;
  it('accepts a whole ARC key and tells it apart from a Gemini key', () => {
    expect(looksLikeGeminiKey(arc)).toBe(true);
    expect(isArcKey(arc)).toBe(true);
    expect(keyKind(arc)).toBe('arc');
    expect(keyKind('AIzaSyA1234567890abcdefghijklmnopqrstuv')).toBe('gemini');
    expect(cleanGeminiKey(`ARC_API_KEY=${arc}`)).toBe(arc);
  });
  it('rejects an ARC key that was cut short', () => {
    expect(looksLikeGeminiKey(arc.slice(0, 40))).toBe(false);
  });
});

describe('two optional keys and the choice of AI', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  (globalThis as any).window = { dispatchEvent: () => true };
  const arc = 'ARC_DEE_' + 'a'.repeat(17) + '_PAK_' + 'b'.repeat(43);
  const gem = 'AIza' + 'c'.repeat(35);
  it('keeps an ARC key and a Gemini key side by side and sends both, with the chosen source', async () => {
    const m = await import('./aiKey');
    store.clear();
    m.setUserKey('arc', arc); m.setUserKey('gemini', gem);
    expect(m.getUserKeys()).toEqual({ arc, gemini: gem });
    expect(m.aiKeyHeaders()).toEqual({ 'X-Gemini-Api-Key': gem, 'X-Arc-Api-Key': arc });
    m.setAiSource('mine');
    expect(m.aiKeyHeaders()['X-AI-Source']).toBe('mine');
    m.setUserKey('arc', null); m.setUserKey('gemini', null);
    expect(m.aiKeyHeaders()).toEqual({}); // no keys of your own: the studio's AI, whatever the choice
  });
  it('reads an ARC key saved by the older single-key version as the ARC key', async () => {
    const m = await import('./aiKey');
    store.clear(); store.set('userGeminiApiKey', arc);
    expect(m.getUserKeys()).toEqual({ arc, gemini: null });
  });
});
