import z from 'zod';
import { Tool } from './tool';
import DESCRIPTION from './codesearch.txt';
import { createVerboseFetch } from '../util/verbose-fetch';
import { ExaMcp } from '../util/exa-mcp';

const verboseFetch = createVerboseFetch(fetch, { caller: 'codesearch' });

interface McpCodeRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      tokensNum: number;
    };
  };
}

export const CodeSearchTool = Tool.define('codesearch', {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'"
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        'Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.'
      ),
  }),
  async execute(params, ctx) {
    // No restrictions - unrestricted code search
    const codeRequest: McpCodeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_code_context_exa',
        arguments: {
          query: params.query,
          tokensNum: params.tokensNum || 5000,
        },
      },
    };

    const output = await ExaMcp.call({
      fetch: verboseFetch,
      body: codeRequest,
      timeout: 30000,
      abort: ctx.abort,
      label: 'Code search',
    });

    return {
      output:
        output ??
        'No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.',
      title: `Code search: ${params.query}`,
      metadata: {},
    };
  },
});
