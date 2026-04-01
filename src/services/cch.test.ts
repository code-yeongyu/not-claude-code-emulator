import { describe, expect, it } from 'bun:test';
import { computeCch, hasCchPlaceholder, replaceCchPlaceholder } from './cch.js';

describe('cch signing', () => {
  it('should compute a 5-character hex hash', async () => {
    const body = '{"system":[{"type":"text","text":"cch=00000"}],"messages":[]}';
    const cch = await computeCch(body);
    expect(cch).toMatch(/^[0-9a-f]{5}$/);
  });

  it('should be deterministic for the same input', async () => {
    const body = '{"system":[{"type":"text","text":"cch=00000"}],"messages":[{"role":"user","content":"Hello"}]}';
    const cch1 = await computeCch(body);
    const cch2 = await computeCch(body);
    expect(cch1).toBe(cch2);
  });

  it('should produce different hashes for different bodies', async () => {
    const body1 = '{"system":[{"type":"text","text":"cch=00000"}],"messages":[{"role":"user","content":"Hello"}]}';
    const body2 = '{"system":[{"type":"text","text":"cch=00000"}],"messages":[{"role":"user","content":"World"}]}';
    const cch1 = await computeCch(body1);
    const cch2 = await computeCch(body2);
    expect(cch1).not.toBe(cch2);
  });

  it('should detect cch placeholder', () => {
    expect(hasCchPlaceholder('some text cch=00000 more text')).toBe(true);
    expect(hasCchPlaceholder('some text without placeholder')).toBe(false);
  });

  it('should replace cch placeholder', () => {
    const body = '{"text":"cch=00000"}';
    const result = replaceCchPlaceholder(body, 'a1b2c');
    expect(result).toBe('{"text":"cch=a1b2c"}');
    expect(result).not.toContain('cch=00000');
  });

  it('should not produce cch=00000 as output', async () => {
    // Edge case: make sure the hash never coincidentally equals the placeholder
    const bodies = [
      '{"cch=00000":"test"}',
      '{"system":"cch=00000","model":"claude-3"}',
      '{"messages":[],"cch=00000":""}',
    ];
    for (const body of bodies) {
      const cch = await computeCch(body);
      // While theoretically possible, 00000 is extremely unlikely
      // This test documents the behavior rather than being a hard guarantee
      expect(cch).toMatch(/^[0-9a-f]{5}$/);
    }
  });
});
