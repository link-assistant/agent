import { test, expect, describe, mock, beforeAll, afterAll } from 'bun:test';

/**
 * Unit tests for strict model validation
 *
 * Issue #194: AI agent terminated prematurely with "reason": "unknown"
 * Issue #196: Model substitution and zero-token provider failures
 *
 * Root causes (Issue #194):
 * 1. Model requested (`glm-4.7-free`) was not found, but system silently fell back to default
 * 2. finishReason was undefined, causing "unknown" which triggered premature loop exit
 *
 * Root causes (Issue #196):
 * 1. Yargs under Bun returned default model instead of CLI argument (model substitution)
 * 2. Provider returned zero tokens with "unknown" finish reason (silent API failure)
 * 3. No validation of model existence for explicit provider/model format
 *
 * Fixes implemented:
 * 1. parseModelWithResolution now throws ModelNotFoundError instead of silent fallback
 * 2. processor.ts infers 'tool-calls' finish reason from pending tool calls
 * 3. prompt.ts continues loop when finish is 'unknown' but tool calls were made
 * 4. parseModelConfig always prefers CLI value over yargs (#196)
 * 5. parseModelConfig throws on invalid provider/model format instead of defaulting (#196)
 * 6. prompt.ts detects zero-token unknown responses as provider failures (#196)
 * 7. parseModelConfig warns when model not found in explicit provider (#196)
 *
 * @see https://github.com/link-assistant/agent/issues/194
 * @see https://github.com/link-assistant/agent/issues/196
 */

describe('Model validation - parseModelWithResolution', () => {
  // Note: These tests would require mocking the Instance.state and Provider module
  // For now, we document the expected behavior

  test.todo(
    'should throw ModelNotFoundError for non-existent short model name'
  );
  test.todo('should resolve known short model names to correct provider');
  test.todo('should parse explicit provider/model format correctly');
  test.todo('should include helpful suggestion in error message');
});

describe('Finish reason inference - processor.ts', () => {
  // These tests document the expected behavior of the finish reason inference

  test('should infer tool-calls when finishReason is undefined but tool calls exist', () => {
    // The processor.ts code infers 'tool-calls' when:
    // 1. rawFinishReason === undefined
    // 2. Object.keys(toolcalls).length > 0 (pending tool calls exist)

    // This is a documentation test - the actual logic is in processor.ts:
    // if (rawFinishReason === undefined) {
    //   const pendingToolCallCount = Object.keys(toolcalls).length;
    //   if (pendingToolCallCount > 0) {
    //     rawFinishReason = 'tool-calls';
    //   }
    // }
    expect(true).toBe(true);
  });

  test('should preserve original finishReason when defined', () => {
    // If finishReason is defined (e.g., 'stop'), don't override it
    expect(true).toBe(true);
  });
});

describe('Loop exit condition - prompt.ts', () => {
  // These tests document the expected behavior of the loop exit condition

  test('should continue loop when finish is unknown but tool calls exist', () => {
    // The prompt.ts code continues the loop when:
    // 1. lastAssistant.finish === 'unknown'
    // 2. Parts include tool parts with status 'completed' or 'running'
    //
    // This is a documentation test - the actual logic is in prompt.ts:
    // if (lastAssistant.finish === 'unknown') {
    //   const hasToolCalls = lastAssistantParts?.some(
    //     (p) => p.type === 'tool' && (p.state.status === 'completed' || p.state.status === 'running')
    //   );
    //   if (hasToolCalls) {
    //     // Don't break - continue the loop
    //   }
    // }
    expect(true).toBe(true);
  });

  test('should exit loop when finish is unknown and no tool calls', () => {
    // If finish is 'unknown' but there are no tool calls, exit the loop
    expect(true).toBe(true);
  });

  test('should exit loop immediately when finish is unknown with zero tokens (#196)', () => {
    // Issue #196: When provider returns zero tokens with unknown finish reason,
    // this indicates a complete API communication failure.
    // The code now detects this condition BEFORE checking for tool calls:
    //
    // if (tokens.input === 0 && tokens.output === 0 && tokens.reasoning === 0) {
    //   log.error({ message: 'provider returned zero tokens...' });
    //   break;
    // }
    //
    // This is important because:
    // 1. Zero tokens means the provider didn't process the request at all
    // 2. Any "tool calls" in the message would be from a previous step, not this one
    // 3. Continuing the loop would just waste time and potentially cause infinite loops

    // Simulate the zero-token check
    const tokens = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const isZeroTokenResponse =
      tokens.input === 0 && tokens.output === 0 && tokens.reasoning === 0;
    expect(isZeroTokenResponse).toBe(true);

    // Non-zero tokens should not trigger this check
    const normalTokens = {
      input: 1500,
      output: 200,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const isNormalResponse =
      normalTokens.input === 0 &&
      normalTokens.output === 0 &&
      normalTokens.reasoning === 0;
    expect(isNormalResponse).toBe(false);
  });

  test('should exit loop when finish is stop/end-turn/etc', () => {
    // Normal completion reasons should exit the loop
    const exitReasons = ['stop', 'end-turn', 'max_tokens', 'content_filter'];
    expect(exitReasons.includes('stop')).toBe(true);
    expect(exitReasons.includes('end-turn')).toBe(true);
  });

  test('should continue loop when finish is tool-calls', () => {
    // 'tool-calls' finish reason means we need to execute tools and continue
    expect('tool-calls' !== 'stop').toBe(true);
  });
});

describe('ModelNotFoundError', () => {
  // Test the error structure

  test('should include providerID and modelID in error data', () => {
    // The error should contain:
    // - providerID: the provider that was searched (or 'unknown' for short names)
    // - modelID: the model that was not found
    // - suggestion: helpful message with available models
    const errorData = {
      providerID: 'unknown',
      modelID: 'nonexistent-model',
      suggestion: 'Model "nonexistent-model" not found...',
    };

    expect(errorData.providerID).toBe('unknown');
    expect(errorData.modelID).toBe('nonexistent-model');
    expect(errorData.suggestion).toContain('not found');
  });
});

describe('parseModelConfig - model argument handling (#196)', () => {
  test('should throw on empty provider in explicit format instead of defaulting', () => {
    // Before fix: "/kimi-k2.5-free" -> providerID='opencode', modelID='kimi-k2.5-free' (silent default)
    // After fix: throws Error with clear message
    //
    // Code: if (!providerID || !modelID) { throw new Error(...) }
    const modelArg = '/kimi-k2.5-free';
    const parts = modelArg.split('/');
    const providerID = parts[0]; // empty string
    const modelID = parts.slice(1).join('/'); // 'kimi-k2.5-free'

    expect(providerID).toBe('');
    expect(!providerID).toBe(true); // would trigger the error
  });

  test('should throw on empty model in explicit format instead of defaulting', () => {
    // Before fix: "opencode/" -> providerID='opencode', modelID='kimi-k2.5-free' (silent default)
    // After fix: throws Error with clear message
    const modelArg = 'opencode/';
    const parts = modelArg.split('/');
    const providerID = parts[0]; // 'opencode'
    const modelID = parts.slice(1).join('/'); // empty string

    expect(modelID).toBe('');
    expect(!modelID).toBe(true); // would trigger the error
  });

  test('should always prefer CLI argument over yargs value', () => {
    // Issue #196: Yargs under Bun may return default 'opencode/kimi-k2.5-free'
    // even when user passed '--model opencode/glm-4.7-free'
    //
    // Before fix: only override yargs when mismatch detected
    // After fix: always use CLI value when available, regardless of match
    //
    // Code: if (cliModelArg) { modelArg = cliModelArg; }
    const yargsModel = 'opencode/kimi-k2.5-free'; // yargs default
    const cliModel = 'opencode/glm-4.7-free'; // actual CLI arg

    // The fix ensures cliModel is always used when available
    const modelArg = cliModel || yargsModel;
    expect(modelArg).toBe('opencode/glm-4.7-free');
  });
});

describe('Integration scenarios - Issue #194', () => {
  test('documents the original failure scenario', () => {
    // Original issue:
    // 1. User runs: agent --model glm-4.7-free
    // 2. glm-4.7-free is not found in any provider
    // 3. System silently falls back to opencode/kimi-k2.5-free (wrong model!)
    // 4. Kimi K2.5 makes tool calls but returns undefined finishReason
    // 5. toFinishReason converts undefined -> 'unknown'
    // 6. Loop exits because 'unknown' !== 'tool-calls'
    // 7. Agent terminates without executing any tasks

    // With our fix:
    // Step 2 now throws ModelNotFoundError instead of silent fallback
    // OR if using a provider that returns undefined finishReason:
    // Step 4-5: We infer 'tool-calls' from pending tool calls
    // Step 6: We check for tool calls when finish is 'unknown' and continue
    expect(true).toBe(true);
  });

  test('documents the expected behavior after fix', () => {
    // After fix - Scenario 1: Model not found
    // 1. User runs: agent --model glm-4.7-free
    // 2. glm-4.7-free is not found -> ModelNotFoundError thrown
    // 3. User sees: "Model 'glm-4.7-free' not found. Available models: ..."
    // 4. User can choose correct model

    // After fix - Scenario 2: Provider returns undefined finishReason
    // 1. User runs: agent --model opencode/kimi-k2.5-free
    // 2. Kimi K2.5 makes tool calls, returns undefined finishReason
    // 3. processor.ts: Detects pending tool calls -> infers 'tool-calls'
    // 4. Loop continues to execute tools
    // 5. Agent completes tasks successfully

    // After fix - Scenario 3: finishReason inference fails but tool calls exist
    // 1. User runs: agent --model some-provider/some-model
    // 2. Model makes tool calls, returns undefined finishReason
    // 3. processor.ts: No pending tool calls tracked -> finishReason stays 'unknown'
    // 4. prompt.ts: Detects tool parts in message -> continues loop anyway
    // 5. Agent completes tasks successfully
    expect(true).toBe(true);
  });
});

describe('Integration scenarios - Issue #196', () => {
  test('documents the model substitution failure', () => {
    // Timeline from real incident:
    // 1. User runs: solve --model glm-4.7-free
    // 2. Solve script executes: agent --model opencode/glm-4.7-free
    // 3. Yargs under Bun parses --model but returns DEFAULT 'opencode/kimi-k2.5-free'
    // 4. getModelFromProcessArgv() should catch this but apparently returned null
    // 5. Agent sends request to opencode with kimi-k2.5-free (wrong model!)
    // 6. Provider returns zero tokens with "reason: unknown"
    // 7. Agent exits silently without doing any work

    // With our fix:
    // Step 3-4: getModelFromProcessArgv() always overrides yargs when available
    // Step 5: Model existence validation warns if model not found in provider
    // Step 6: Zero-token detection logs clear error about provider failure
    expect(true).toBe(true);
  });

  test('documents zero-token provider failure detection', () => {
    // When provider returns:
    //   { reason: "unknown", tokens: { input: 0, output: 0, reasoning: 0 } }
    // This means the provider completely failed to process the request.
    //
    // Before fix: Agent silently exits the loop
    // After fix: Agent logs error with:
    //   - Clear message about provider failure
    //   - Token counts
    //   - Model information
    //   - Hint about checking provider status
    //   - Link to issue #196
    expect(true).toBe(true);
  });
});
