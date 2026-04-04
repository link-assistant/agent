/**
 * Experiment: Test verbose HTTP logging in server mode
 * The default agent mode uses server=true, which starts a local HTTP server
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { config, setVerbose } from '../src/config/agent-config';
import { Log } from '../src/util/log';
import { Instance } from '../src/project/instance';
import { Provider } from '../src/provider/provider';
import { Server } from '../src/server/server';
import { Session } from '../src/session/index';
import { SessionPrompt } from '../src/session/prompt';

// Enable verbose
setVerbose(true);

// Init logging
await Log.init({
  print: true,
  level: 'DEBUG',
});

console.error('[TEST] Verbose mode enabled');
console.error('[TEST] config.verbose =', config.verbose);

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    console.error('[TEST] Inside Instance.provide');

    // Start server like the real agent does
    const server = Server.listen({ port: 0, hostname: '127.0.0.1' });
    console.error('[TEST] Server started on port', server.port);

    try {
      // Create session via server
      const createRes = await fetch(
        `http://${server.hostname}:${server.port}/session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const session = await createRes.json();
      console.error('[TEST] Session created:', session.id);

      // Send a message - this triggers the LLM call
      console.error('[TEST] Sending message to session...');
      const msgRes = await fetch(
        `http://${server.hostname}:${server.port}/session/${session.id}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parts: [{ type: 'text', text: 'Say just "hello"' }],
            model: {
              providerID: 'opencode',
              modelID: 'minimax-m2.5-free',
            },
          }),
        }
      );
      console.error('[TEST] Message sent, status:', msgRes.status);

      // Wait a bit for the LLM call to happen
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } finally {
      server.stop();
      await Instance.dispose();
    }
  },
});

console.error('[TEST] === DONE ===');
process.exit(0);
