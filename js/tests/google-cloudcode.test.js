/* global URL */
import { test, expect, describe } from 'bun:test';

/**
 * Test suite for Google Cloud Code API subscription support - Issue #102
 *
 * Tests the request/response transformations, thoughtSignature injection,
 * and retry logic used for Google AI subscription authentication
 * via the Cloud Code API.
 */
describe('Google Cloud Code API request transformations', () => {
  /**
   * Helper: Simulate the thoughtSignature injection logic
   * from src/auth/plugins.ts (GooglePlugin loader)
   */
  function injectThoughtSignatures(request) {
    const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

    if (!request?.contents || !Array.isArray(request.contents)) {
      return request;
    }

    // Find the start of the active loop (last user turn with text)
    let activeLoopStartIndex = -1;
    for (let i = request.contents.length - 1; i >= 0; i--) {
      const content = request.contents[i];
      if (content.role === 'user' && content.parts?.some((p) => p.text)) {
        activeLoopStartIndex = i;
        break;
      }
    }

    if (activeLoopStartIndex === -1) {
      return request;
    }

    const newContents = [...request.contents];
    for (let i = activeLoopStartIndex; i < newContents.length; i++) {
      const content = newContents[i];
      if (content.role === 'model' && content.parts) {
        const newParts = [...content.parts];
        for (let j = 0; j < newParts.length; j++) {
          const part = newParts[j];
          if (part.functionCall && !part.thoughtSignature) {
            newParts[j] = {
              ...part,
              thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
            };
            newContents[i] = { ...content, parts: newParts };
            break;
          }
        }
      }
    }

    return { ...request, contents: newContents };
  }

  /**
   * Helper: Simulate the Cloud Code request body transformation
   */
  function transformRequestBody(body, model, projectId) {
    const parsed = JSON.parse(body);
    const injected = injectThoughtSignatures(parsed);
    const cloudCodeRequest = {
      model,
      ...(projectId && { project: projectId }),
      request: injected,
    };
    return JSON.stringify(cloudCodeRequest);
  }

  /**
   * Helper: Simulate Cloud Code URL transformation
   */
  function transformToCloudCodeUrl(url) {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('generativelanguage.googleapis.com')) {
      return null;
    }
    const pathMatch = parsed.pathname.match(/:(\w+)$/);
    if (!pathMatch) {
      return null;
    }
    const method = pathMatch[1];
    return `https://cloudcode-pa.googleapis.com/v1internal:${method}`;
  }

  /**
   * Helper: Extract model from URL
   */
  function extractModelFromUrl(url) {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/models\/([^:]+):/);
    return pathMatch ? pathMatch[1] : null;
  }

  // --- URL transformation tests ---

  test('transforms generateContent URL to Cloud Code format', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';
    const result = transformToCloudCodeUrl(url);
    expect(result).toBe(
      'https://cloudcode-pa.googleapis.com/v1internal:generateContent'
    );
  });

  test('transforms streamGenerateContent URL to Cloud Code format', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';
    const result = transformToCloudCodeUrl(url);
    expect(result).toBe(
      'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent'
    );
  });

  test('transforms countTokens URL to Cloud Code format', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:countTokens';
    const result = transformToCloudCodeUrl(url);
    expect(result).toBe(
      'https://cloudcode-pa.googleapis.com/v1internal:countTokens'
    );
  });

  test('returns null for non-Google URLs', () => {
    const url = 'https://api.openai.com/v1/chat/completions';
    const result = transformToCloudCodeUrl(url);
    expect(result).toBeNull();
  });

  test('returns null for URLs without method', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview';
    const result = transformToCloudCodeUrl(url);
    expect(result).toBeNull();
  });

  // --- Model extraction tests ---

  test('extracts model name from URL', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';
    const result = extractModelFromUrl(url);
    expect(result).toBe('gemini-3-pro-preview');
  });

  test('extracts flash model name from URL', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent';
    const result = extractModelFromUrl(url);
    expect(result).toBe('gemini-2.5-flash');
  });

  // --- Request body transformation tests ---

  test('wraps request body in Cloud Code format', () => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: { temperature: 0.7 },
    });

    const result = JSON.parse(
      transformRequestBody(body, 'gemini-3-pro-preview', 'my-project-123')
    );

    expect(result.model).toBe('gemini-3-pro-preview');
    expect(result.project).toBe('my-project-123');
    expect(result.request.contents).toHaveLength(1);
    expect(result.request.contents[0].parts[0].text).toBe('Hello');
    expect(result.request.generationConfig.temperature).toBe(0.7);
  });

  test('wraps request body without project when not available', () => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    });

    const result = JSON.parse(
      transformRequestBody(body, 'gemini-3-pro-preview', undefined)
    );

    expect(result.model).toBe('gemini-3-pro-preview');
    expect(result.project).toBeUndefined();
    expect(result.request.contents).toHaveLength(1);
  });

  // --- thoughtSignature injection tests ---

  test('injects thoughtSignature into function call parts in active loop', () => {
    const request = {
      contents: [
        // User message (start of active loop)
        { role: 'user', parts: [{ text: 'List files in /tmp' }] },
        // Model response with function call (should get thoughtSignature)
        {
          role: 'model',
          parts: [
            { text: 'I will list the files.' },
            { functionCall: { name: 'bash', args: { command: 'ls /tmp' } } },
          ],
        },
        // User (tool response)
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'bash',
                response: { output: 'file1.txt\nfile2.txt' },
              },
            },
          ],
        },
      ],
    };

    const result = injectThoughtSignatures(request);

    // The function call part should have thoughtSignature
    expect(result.contents[1].parts[1].thoughtSignature).toBe(
      'skip_thought_signature_validator'
    );
    // The text part should NOT have thoughtSignature
    expect(result.contents[1].parts[0].thoughtSignature).toBeUndefined();
  });

  test('preserves existing thoughtSignature values', () => {
    const request = {
      contents: [
        { role: 'user', parts: [{ text: 'Test' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: { name: 'test', args: {} },
              thoughtSignature: 'existing-signature',
            },
          ],
        },
      ],
    };

    const result = injectThoughtSignatures(request);

    // Should preserve the existing signature
    expect(result.contents[1].parts[0].thoughtSignature).toBe(
      'existing-signature'
    );
  });

  test('does not inject thoughtSignature before active loop', () => {
    const request = {
      contents: [
        // Old user message
        { role: 'user', parts: [{ text: 'Old message' }] },
        // Old model response with function call (before active loop)
        {
          role: 'model',
          parts: [{ functionCall: { name: 'old_tool', args: {} } }],
        },
        // Old tool response
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'old_tool', response: {} } }],
        },
        // NEW user message (start of active loop)
        { role: 'user', parts: [{ text: 'New message' }] },
        // Model response in active loop
        {
          role: 'model',
          parts: [{ functionCall: { name: 'new_tool', args: {} } }],
        },
      ],
    };

    const result = injectThoughtSignatures(request);

    // Old function call (before active loop) should NOT get thoughtSignature
    expect(result.contents[1].parts[0].thoughtSignature).toBeUndefined();
    // New function call (in active loop) SHOULD get thoughtSignature
    expect(result.contents[4].parts[0].thoughtSignature).toBe(
      'skip_thought_signature_validator'
    );
  });

  test('handles request with no function calls', () => {
    const request = {
      contents: [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ],
    };

    const result = injectThoughtSignatures(request);

    // Should be unchanged
    expect(result.contents[0].parts[0].text).toBe('Hello');
    expect(result.contents[1].parts[0].text).toBe('Hi there!');
  });

  test('handles empty request', () => {
    const request = {};
    const result = injectThoughtSignatures(request);
    expect(result).toEqual({});
  });

  test('handles request with no user text (only function responses)', () => {
    const request = {
      contents: [
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'test', response: {} } }],
        },
        {
          role: 'model',
          parts: [{ functionCall: { name: 'test2', args: {} } }],
        },
      ],
    };

    const result = injectThoughtSignatures(request);

    // No active loop found (no user turn with text), so no injection
    expect(result.contents[1].parts[0].thoughtSignature).toBeUndefined();
  });

  test('only injects into first function call per model turn', () => {
    const request = {
      contents: [
        { role: 'user', parts: [{ text: 'Do two things' }] },
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'tool1', args: {} } },
            { functionCall: { name: 'tool2', args: {} } },
          ],
        },
      ],
    };

    const result = injectThoughtSignatures(request);

    // First function call should get thoughtSignature
    expect(result.contents[1].parts[0].thoughtSignature).toBe(
      'skip_thought_signature_validator'
    );
    // Second function call should NOT
    expect(result.contents[1].parts[1].thoughtSignature).toBeUndefined();
  });

  // --- Streaming detection tests ---

  test('detects streaming requests from URL method', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent';
    expect(
      url.includes('streamGenerateContent') || url.includes('alt=sse')
    ).toBe(true);
  });

  test('detects streaming requests from alt=sse parameter', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?alt=sse';
    expect(
      url.includes('streamGenerateContent') || url.includes('alt=sse')
    ).toBe(true);
  });

  test('does not detect non-streaming requests', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';
    expect(
      url.includes('streamGenerateContent') || url.includes('alt=sse')
    ).toBe(false);
  });
});

describe('Cloud Code API response unwrapping', () => {
  test('unwraps non-streaming Cloud Code response', () => {
    const cloudCodeResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello!' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      },
      traceId: 'trace-123',
    };

    // Simulate unwrapping
    const unwrapped = cloudCodeResponse.response || cloudCodeResponse;

    expect(unwrapped.candidates).toHaveLength(1);
    expect(unwrapped.candidates[0].content.parts[0].text).toBe('Hello!');
    expect(unwrapped.usageMetadata.totalTokenCount).toBe(15);
  });

  test('passes through response without wrapper', () => {
    const standardResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Hello!' }],
          },
          finishReason: 'STOP',
        },
      ],
    };

    const unwrapped = standardResponse.response || standardResponse;

    expect(unwrapped.candidates).toHaveLength(1);
    expect(unwrapped.candidates[0].content.parts[0].text).toBe('Hello!');
  });
});
