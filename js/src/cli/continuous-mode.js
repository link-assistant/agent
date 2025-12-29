/**
 * Continuous stdin mode for the Agent CLI.
 * Keeps the session alive and processes messages as they arrive.
 */

import { Server } from '../server/server.ts';
import { Instance } from '../project/instance.ts';
import { Bus } from '../bus/index.ts';
import { Session } from '../session/index.ts';
import { SessionPrompt } from '../session/prompt.ts';
import { createEventHandler } from '../json-standard/index.ts';
import { createContinuousStdinReader } from './input-queue.js';

// Shared error tracking
let hasError = false;

/**
 * Set error state
 * @param {boolean} value - Error state value
 */
export function setHasError(value) {
  hasError = value;
}

/**
 * Get error state
 * @returns {boolean}
 */
export function getHasError() {
  return hasError;
}

/**
 * Output JSON status message to stderr
 * @param {object} status - Status object to output
 * @param {boolean} compact - If true, output compact JSON (single line)
 */
function outputStatus(status, compact = false) {
  const json = compact
    ? JSON.stringify(status)
    : JSON.stringify(status, null, 2);
  console.error(json);
}

/**
 * Run server mode with continuous stdin input
 * Keeps the session alive and processes messages as they arrive
 */
export async function runContinuousServerMode(
  argv,
  providerID,
  modelID,
  systemMessage,
  appendSystemMessage,
  jsonStandard
) {
  const compactJson = argv['compact-json'] === true;
  const isInteractive = argv.interactive !== false;
  const autoMerge = argv['auto-merge-queued-messages'] !== false;

  // Start server like OpenCode does
  const server = Server.listen({ port: 0, hostname: '127.0.0.1' });
  let unsub = null;
  let stdinReader = null;

  try {
    // Create a session
    const createRes = await fetch(
      `http://${server.hostname}:${server.port}/session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    const session = await createRes.json();
    const sessionID = session.id;

    if (!sessionID) {
      throw new Error('Failed to create session');
    }

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID);

    // Track if we're currently processing a message
    let isProcessing = false;
    const pendingMessages = [];

    // Process messages from the queue
    const processMessage = async (message) => {
      if (isProcessing) {
        pendingMessages.push(message);
        return;
      }

      isProcessing = true;
      const messageText = message.message || 'hi';
      const parts = [{ type: 'text', text: messageText }];

      // Create a promise to wait for this message to complete
      const messagePromise = new Promise((resolve) => {
        const checkIdle = Bus.subscribeAll((event) => {
          if (
            event.type === 'session.idle' &&
            event.properties.sessionID === sessionID
          ) {
            checkIdle();
            resolve();
          }
        });
      });

      // Send message
      fetch(
        `http://${server.hostname}:${server.port}/session/${sessionID}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parts,
            model: { providerID, modelID },
            system: systemMessage,
            appendSystem: appendSystemMessage,
          }),
        }
      ).catch((error) => {
        hasError = true;
        eventHandler.output({
          type: 'error',
          timestamp: Date.now(),
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      await messagePromise;
      isProcessing = false;

      // Process next pending message if any
      if (pendingMessages.length > 0) {
        const nextMessage = pendingMessages.shift();
        processMessage(nextMessage);
      }
    };

    // Subscribe to all bus events and output in selected format
    unsub = Bus.subscribeAll((event) => {
      if (event.type === 'message.part.updated') {
        const part = event.properties.part;
        if (part.sessionID !== sessionID) {
          return;
        }

        if (part.type === 'step-start') {
          eventHandler.output({
            type: 'step_start',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }

        if (part.type === 'step-finish') {
          eventHandler.output({
            type: 'step_finish',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }

        if (part.type === 'text' && part.time?.end) {
          eventHandler.output({
            type: 'text',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }

        if (part.type === 'tool' && part.state.status === 'completed') {
          eventHandler.output({
            type: 'tool_use',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }
      }

      if (event.type === 'session.error') {
        const props = event.properties;
        if (props.sessionID !== sessionID || !props.error) {
          return;
        }
        hasError = true;
        eventHandler.output({
          type: 'error',
          timestamp: Date.now(),
          sessionID,
          error: props.error,
        });
      }
    });

    // Create continuous stdin reader
    stdinReader = createContinuousStdinReader({
      interactive: isInteractive,
      autoMerge,
      onMessage: (message) => {
        processMessage(message);
      },
    });

    // Wait for stdin to end (EOF or close)
    await new Promise((resolve) => {
      const checkRunning = setInterval(() => {
        if (!stdinReader.isRunning()) {
          clearInterval(checkRunning);
          // Wait for any pending messages to complete
          const waitForPending = () => {
            if (!isProcessing && pendingMessages.length === 0) {
              resolve();
            } else {
              setTimeout(waitForPending, 100);
            }
          };
          waitForPending();
        }
      }, 100);

      // Also handle SIGINT
      process.on('SIGINT', () => {
        outputStatus(
          {
            type: 'status',
            message: 'Received SIGINT. Shutting down...',
          },
          compactJson
        );
        clearInterval(checkRunning);
        resolve();
      });
    });
  } finally {
    if (stdinReader) {
      stdinReader.stop();
    }
    if (unsub) {
      unsub();
    }
    server.stop();
    await Instance.dispose();
  }
}

/**
 * Run direct mode with continuous stdin input
 * Keeps the session alive and processes messages as they arrive
 */
export async function runContinuousDirectMode(
  argv,
  providerID,
  modelID,
  systemMessage,
  appendSystemMessage,
  jsonStandard
) {
  const compactJson = argv['compact-json'] === true;
  const isInteractive = argv.interactive !== false;
  const autoMerge = argv['auto-merge-queued-messages'] !== false;

  let unsub = null;
  let stdinReader = null;

  try {
    // Create a session directly
    const session = await Session.createNext({
      directory: process.cwd(),
    });
    const sessionID = session.id;

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID);

    // Track if we're currently processing a message
    let isProcessing = false;
    const pendingMessages = [];

    // Process messages from the queue
    const processMessage = async (message) => {
      if (isProcessing) {
        pendingMessages.push(message);
        return;
      }

      isProcessing = true;
      const messageText = message.message || 'hi';
      const parts = [{ type: 'text', text: messageText }];

      // Create a promise to wait for this message to complete
      const messagePromise = new Promise((resolve) => {
        const checkIdle = Bus.subscribeAll((event) => {
          if (
            event.type === 'session.idle' &&
            event.properties.sessionID === sessionID
          ) {
            checkIdle();
            resolve();
          }
        });
      });

      // Send message directly
      SessionPrompt.prompt({
        sessionID,
        parts,
        model: { providerID, modelID },
        system: systemMessage,
        appendSystem: appendSystemMessage,
      }).catch((error) => {
        hasError = true;
        eventHandler.output({
          type: 'error',
          timestamp: Date.now(),
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      await messagePromise;
      isProcessing = false;

      // Process next pending message if any
      if (pendingMessages.length > 0) {
        const nextMessage = pendingMessages.shift();
        processMessage(nextMessage);
      }
    };

    // Subscribe to all bus events and output in selected format
    unsub = Bus.subscribeAll((event) => {
      if (event.type === 'message.part.updated') {
        const part = event.properties.part;
        if (part.sessionID !== sessionID) {
          return;
        }

        if (part.type === 'step-start') {
          eventHandler.output({
            type: 'step_start',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }

        if (part.type === 'step-finish') {
          eventHandler.output({
            type: 'step_finish',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }

        if (part.type === 'text' && part.time?.end) {
          eventHandler.output({
            type: 'text',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }

        if (part.type === 'tool' && part.state.status === 'completed') {
          eventHandler.output({
            type: 'tool_use',
            timestamp: Date.now(),
            sessionID,
            part,
          });
        }
      }

      if (event.type === 'session.error') {
        const props = event.properties;
        if (props.sessionID !== sessionID || !props.error) {
          return;
        }
        hasError = true;
        eventHandler.output({
          type: 'error',
          timestamp: Date.now(),
          sessionID,
          error: props.error,
        });
      }
    });

    // Create continuous stdin reader
    stdinReader = createContinuousStdinReader({
      interactive: isInteractive,
      autoMerge,
      onMessage: (message) => {
        processMessage(message);
      },
    });

    // Wait for stdin to end (EOF or close)
    await new Promise((resolve) => {
      const checkRunning = setInterval(() => {
        if (!stdinReader.isRunning()) {
          clearInterval(checkRunning);
          // Wait for any pending messages to complete
          const waitForPending = () => {
            if (!isProcessing && pendingMessages.length === 0) {
              resolve();
            } else {
              setTimeout(waitForPending, 100);
            }
          };
          waitForPending();
        }
      }, 100);

      // Also handle SIGINT
      process.on('SIGINT', () => {
        outputStatus(
          {
            type: 'status',
            message: 'Received SIGINT. Shutting down...',
          },
          compactJson
        );
        clearInterval(checkRunning);
        resolve();
      });
    });
  } finally {
    if (stdinReader) {
      stdinReader.stop();
    }
    if (unsub) {
      unsub();
    }
    await Instance.dispose();
  }
}
