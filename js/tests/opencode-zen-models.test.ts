import { describe, expect, test } from 'bun:test';
import { OpenCodeZen } from '../src/provider/opencode-zen';
import { Provider } from '../src/provider/provider';

describe('OpenCode Zen live model endpoint (#266)', () => {
  test('parses model ids from the live models endpoint response', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'minimax-m2.5-free', object: 'model' },
            { id: 'ling-2.6-flash-free', object: 'model' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const ids = await OpenCodeZen.fetchModelIDs(fetchFn as typeof fetch);
    expect(ids.has('minimax-m2.5-free')).toBe(true);
    expect(ids.has('ling-2.6-flash-free')).toBe(true);
  });

  test('creates metadata for live free models when models.dev lags', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'hy3-preview-free', object: 'model' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const info = await OpenCodeZen.getLiveFreeModelInfo(
      'hy3-preview-free',
      fetchFn as typeof fetch
    );
    expect(info?.id).toBe('hy3-preview-free');
    expect(info?.cost.input).toBe(0);
    expect(info?.cost.output).toBe(0);
    expect(info?.tool_call).toBe(true);
    expect(info?.provider?.npm).toBe('@ai-sdk/openai-compatible');
  });

  test('does not synthesize paid models from an availability-only response', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'claude-opus-4-7', object: 'model' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const info = await OpenCodeZen.getLiveFreeModelInfo(
      'claude-opus-4-7',
      fetchFn as typeof fetch
    );
    expect(info).toBeUndefined();
  });

  test('does not synthesize deprecated free models from the live endpoint', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'trinity-large-preview-free', object: 'model' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const info = await OpenCodeZen.getLiveFreeModelInfo(
      'trinity-large-preview-free',
      fetchFn as typeof fetch
    );
    expect(info).toBeUndefined();
  });

  test('provider sorting prioritizes MiniMax M2.5 among current free Zen models', () => {
    const sorted = Provider.sort([
      { id: 'big-pickle' },
      { id: 'gpt-5-nano' },
      { id: 'nemotron-3-super-free' },
      { id: 'ling-2.6-flash-free' },
      { id: 'hy3-preview-free' },
      { id: 'minimax-m2.5-free' },
    ] as any);

    expect(sorted[0].id).toBe('minimax-m2.5-free');
  });
});
