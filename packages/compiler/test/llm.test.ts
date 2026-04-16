/**
 * parseJsonResponse — strips code fences and parses JSON out of LLM output.
 */

import { describe, expect, it } from 'bun:test';
import { parseJsonResponse } from '../src/llm.js';

describe('parseJsonResponse', () => {
  it('parses plain JSON', async () => {
    const got = await parseJsonResponse<{ n: number }>('{"n": 42}');
    expect(got.n).toBe(42);
  });

  it('strips ```json fences', async () => {
    const raw = '```json\n{"hello": "world"}\n```';
    expect((await parseJsonResponse<{ hello: string }>(raw)).hello).toBe('world');
  });

  it('strips ``` fences without language tag', async () => {
    const raw = '```\n{"x": 1}\n```';
    expect((await parseJsonResponse<{ x: number }>(raw)).x).toBe(1);
  });

  it('tolerates leading / trailing whitespace', async () => {
    expect((await parseJsonResponse<{ a: boolean }>('   {"a": true}   \n')).a).toBe(true);
  });

  it('rejects on invalid JSON', async () => {
    expect(parseJsonResponse('not json at all')).rejects.toThrow();
  });

  it('handles nested objects and arrays', async () => {
    const raw = '```json\n{"xs": [1, 2, 3], "inner": {"k": "v"}}\n```';
    const got = await parseJsonResponse<{ xs: number[]; inner: { k: string } }>(raw);
    expect(got.xs).toEqual([1, 2, 3]);
    expect(got.inner.k).toBe('v');
  });

  it('finds the JSON object even when wrapped in prose', async () => {
    const raw = 'Here is the JSON: {"ok": true} hope that helps!';
    expect((await parseJsonResponse<{ ok: boolean }>(raw)).ok).toBe(true);
  });
});
