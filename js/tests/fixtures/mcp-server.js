// Minimal MCP stdio server for tests/mcp-reliability.ts.
// Behaviour is selected with the first argument:
//   ok        tools capability, one `echo` tool, results chosen by `kind`
//   hang      never answers `initialize`
//   notools   prompts capability only
//   dupcursor tools/list always returns the same nextCursor
//   stall     answers the first tools/list, then never again
import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'ok';
let listCalls = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

const tool = {
  name: 'echo',
  description: 'echo',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { $ref: '#/$defs/Kind', description: 'result kind' },
    },
    $defs: { Kind: { type: 'string' } },
  },
};

function callResult(kind) {
  switch (kind) {
    case 'structured':
      return { structuredContent: { a: 1 } };
    case 'toolResult':
      return { toolResult: { b: 2 } };
    case 'resource':
      return {
        content: [
          { type: 'text', text: 'head' },
          {
            type: 'resource',
            resource: { uri: 'file:///r.txt', text: 'resource text' },
          },
          {
            type: 'resource',
            resource: {
              uri: 'file:///r.png',
              mimeType: 'image/png',
              blob: 'iVBORw0KGgo=',
            },
          },
          {
            type: 'resource',
            resource: {
              uri: 'file:///r.bin',
              mimeType: 'application/octet-stream',
              blob: 'AAAA',
            },
          },
          { type: 'resource_link', uri: 'file:///l.txt', name: 'link' },
        ],
      };
    case 'error':
      return { content: [], isError: true };
    default:
      return { content: [{ type: 'text', text: 'echo' }] };
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) {
    return;
  }
  const msg = JSON.parse(line);
  if (msg.id === undefined) {
    return;
  }
  if (msg.method === 'initialize') {
    if (mode === 'hang') {
      return;
    }
    send({
      id: msg.id,
      result: {
        protocolVersion: msg.params.protocolVersion,
        capabilities: mode === 'notools' ? { prompts: {} } : { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    listCalls++;
    if (mode === 'stall' && listCalls > 1) {
      return;
    }
    send({
      id: msg.id,
      result: {
        tools: [tool],
        ...(mode === 'dupcursor' ? { nextCursor: 'a' } : {}),
      },
    });
    return;
  }
  if (msg.method === 'tools/call') {
    if (msg.params.arguments?.kind === 'slow') {
      return;
    }
    send({ id: msg.id, result: callResult(msg.params.arguments?.kind) });
    return;
  }
  send({ id: msg.id, error: { code: -32601, message: 'Method not found' } });
});
