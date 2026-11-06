import { readBounded } from './read-bounded';

// Shared transport for the Exa MCP tools (websearch, codesearch).
export namespace ExaMcp {
  export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

  // The anonymous endpoint is rate-limited; an EXA_API_KEY lifts the limit
  // (upstream fde3d9133b, #16362). An empty value counts as unset.
  export function url() {
    const key = process.env.EXA_API_KEY;
    return key
      ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(key)}`
      : 'https://mcp.exa.ai/mcp';
  }

  type Message = {
    result?: { content?: Array<{ type: string; text: string }> };
  };

  function first(message: Message | undefined) {
    const content = message?.result?.content;
    return content && content.length > 0 ? content[0].text : undefined;
  }

  // Exa answers with SSE `data:` lines or with a plain JSON body.
  export function parse(text: string): string | undefined {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const result = first(JSON.parse(line.slice(5).trim()));
      if (result !== undefined) return result;
    }
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return undefined;
    try {
      return first(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }

  // The request timeout covers the body read too, and the body is bounded
  // (upstream 69f1ec22e3, #33259).
  export async function call(input: {
    fetch: typeof fetch;
    body: unknown;
    timeout: number;
    abort: AbortSignal;
    label: string;
  }): Promise<string | undefined> {
    const timeoutSignal = AbortSignal.timeout(input.timeout);
    const tooLarge = () =>
      new Error(`${input.label} error: Response too large (exceeds 5MB limit)`);
    try {
      const response = await input.fetch(url(), {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify(input.body),
        signal: AbortSignal.any([timeoutSignal, input.abort]),
      });
      const text = (
        await readBounded(response, MAX_RESPONSE_SIZE, tooLarge)
      ).toString('utf-8');
      if (!response.ok) {
        throw new Error(`${input.label} error (${response.status}): ${text}`);
      }
      return parse(text);
    } catch (error) {
      // AbortSignal.timeout aborts with a TimeoutError, not an AbortError.
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError') &&
        !input.abort.aborted
      ) {
        throw new Error(`${input.label} request timed out`);
      }
      throw error;
    }
  }
}
