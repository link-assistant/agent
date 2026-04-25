import { test, expect, describe, setDefaultTimeout } from 'bun:test';

/**
 * Tests for --temperature CLI option.
 *
 * Issue #241: Add --temperature option that overrides the per-model and
 * per-agent temperature defaults. When not set, existing behavior must
 * remain unchanged.
 *
 * @see https://github.com/link-assistant/agent/issues/241
 */

setDefaultTimeout(30000);

describe('--temperature CLI option (#241)', () => {
  test('run-options.js defines a temperature option of type number', async () => {
    // Verify yargs option definition exists and is correctly typed.
    // We import buildRunOptions and call it with a mock yargs to inspect options.
    const { buildRunOptions } = await import('../src/cli/run-options.js');

    const options: Record<string, any> = {};
    const mockYargs = {
      option(name: string, config: any) {
        options[name] = config;
        return mockYargs;
      },
    };

    buildRunOptions(mockYargs);

    expect(options['temperature']).toBeDefined();
    expect(options['temperature'].type).toBe('number');
    // Must NOT have a default — when unset, current behavior is preserved.
    expect(options['temperature'].default).toBeUndefined();
  });

  test('ProviderTransform.temperature returns model-specific defaults', async () => {
    const { ProviderTransform } = await import('../src/provider/transform.ts');

    // Qwen models → 0.55
    expect(ProviderTransform.temperature('opencode', 'qwen3-coder')).toBe(0.55);

    // Claude models → undefined (use provider default)
    expect(
      ProviderTransform.temperature('anthropic', 'claude-sonnet-4')
    ).toBeUndefined();

    // Gemini 3 Pro → 1.0
    expect(ProviderTransform.temperature('google', 'gemini-3-pro')).toBe(1.0);

    // Other models → 0
    expect(ProviderTransform.temperature('opencode', 'minimax-m2.5-free')).toBe(
      0
    );
  });

  test('MessageV2.User schema accepts optional temperature field', async () => {
    const { MessageV2 } = await import('../src/session/message-v2.ts');

    // Valid user message without temperature
    const withoutTemp = MessageV2.User.safeParse({
      id: 'msg-1',
      sessionID: 'sess-1',
      role: 'user',
      time: { created: Date.now() },
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'test-model' },
    });
    expect(withoutTemp.success).toBe(true);
    if (withoutTemp.success) {
      expect(withoutTemp.data.temperature).toBeUndefined();
    }

    // Valid user message with temperature
    const withTemp = MessageV2.User.safeParse({
      id: 'msg-2',
      sessionID: 'sess-1',
      role: 'user',
      time: { created: Date.now() },
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'test-model' },
      temperature: 0.7,
    });
    expect(withTemp.success).toBe(true);
    if (withTemp.success) {
      expect(withTemp.data.temperature).toBe(0.7);
    }
  });

  test('SessionPrompt.PromptInput schema accepts optional temperature field', async () => {
    // Dynamically import to get the PromptInput schema
    const { SessionPrompt } = await import('../src/session/prompt.ts');

    // PromptInput with temperature
    const result = SessionPrompt.PromptInput.safeParse({
      sessionID: 'ses_test12345678901234',
      temperature: 0.42,
      parts: [{ type: 'text', text: 'hello' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.temperature).toBe(0.42);
    }

    // PromptInput without temperature (existing behavior)
    const noTemp = SessionPrompt.PromptInput.safeParse({
      sessionID: 'ses_test12345678901234',
      parts: [{ type: 'text', text: 'hello' }],
    });
    expect(noTemp.success).toBe(true);
    if (noTemp.success) {
      expect(noTemp.data.temperature).toBeUndefined();
    }
  });
});

describe('--temperature Rust CLI option (#241)', () => {
  test('Rust Args struct includes optional temperature field', async () => {
    // Read the Rust CLI source to verify the temperature field exists
    const fs = await import('fs');
    const cliSource = fs.readFileSync(
      new URL('../../rust/src/cli.rs', import.meta.url),
      'utf-8'
    );

    // Verify the temperature field is defined as Option<f64>
    expect(cliSource).toContain('pub temperature: Option<f64>');
    // Verify it has the correct arg attribute (no default value)
    expect(cliSource).toContain('#[arg(long)]');
    expect(cliSource).toContain(
      '/// Override the temperature for model completions'
    );
  });
});
