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
import { Log } from '../util/log.ts';

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

// Logger for resume operations
const log = Log.create({ service: 'resume' });

/**
 * Resolve the session to use based on --resume, --continue, and --no-fork options.
 * Returns the session ID to use, handling forking as needed.
 * @param {object} argv - Command line arguments
 * @param {boolean} compactJson - Whether to use compact JSON output
 * @returns {Promise<{sessionID: string, wasResumed: boolean, wasForked: boolean} | null>} - Session info or null if new session should be created
 * @export
 */
export async function resolveResumeSession(argv, compactJson) {
  const resumeSessionID = argv.resume;
  const shouldContinue = argv.continue === true;
  const noFork = argv['no-fork'] === true;

  // If neither --resume nor --continue is specified, return null to create new session
  if (!resumeSessionID && !shouldContinue) {
    return null;
  }

  let targetSessionID = resumeSessionID;

  // If --continue is specified, find the most recent session
  if (shouldContinue && !targetSessionID) {
    let mostRecentSession = null;
    let mostRecentTime = 0;

    for await (const session of Session.list()) {
      // Skip child sessions (those with parentID) - find top-level sessions only
      if (session.parentID) {
        continue;
      }

      if (session.time.updated > mostRecentTime) {
        mostRecentTime = session.time.updated;
        mostRecentSession = session;
      }
    }

    if (!mostRecentSession) {
      outputStatus(
        {
          type: 'error',
          errorType: 'SessionNotFound',
          message:
            'No existing sessions found to continue. Start a new session first.',
        },
        compactJson
      );
      process.exit(1);
    }

    targetSessionID = mostRecentSession.id;
    log.info(() => ({
      message: 'Found most recent session to continue',
      sessionID: targetSessionID,
      title: mostRecentSession.title,
    }));
  }

  // Verify the session exists
  let existingSession;
  try {
    existingSession = await Session.get(targetSessionID);
  } catch (_error) {
    // Session.get throws an error when the session doesn't exist
    outputStatus(
      {
        type: 'error',
        errorType: 'SessionNotFound',
        message: `Session not found: ${targetSessionID}`,
      },
      compactJson
    );
    process.exit(1);
  }

  if (!existingSession) {
    outputStatus(
      {
        type: 'error',
        errorType: 'SessionNotFound',
        message: `Session not found: ${targetSessionID}`,
      },
      compactJson
    );
    process.exit(1);
  }

  log.info(() => ({
    message: 'Resuming session',
    sessionID: targetSessionID,
    title: existingSession.title,
    noFork,
  }));

  // If --no-fork is specified, continue in the same session
  if (noFork) {
    outputStatus(
      {
        type: 'status',
        mode: 'resume',
        message: `Continuing session without forking: ${targetSessionID}`,
        sessionID: targetSessionID,
        title: existingSession.title,
        forked: false,
      },
      compactJson
    );

    return {
      sessionID: targetSessionID,
      wasResumed: true,
      wasForked: false,
    };
  }

  // Fork the session to a new UUID (default behavior)
  const forkedSession = await Session.fork({
    sessionID: targetSessionID,
  });

  outputStatus(
    {
      type: 'status',
      mode: 'resume',
      message: `Forked session ${targetSessionID} to new session: ${forkedSession.id}`,
      originalSessionID: targetSessionID,
      sessionID: forkedSession.id,
      title: forkedSession.title,
      forked: true,
    },
    compactJson
  );

  log.info(() => ({
    message: 'Forked session',
    originalSessionID: targetSessionID,
    newSessionID: forkedSession.id,
  }));

  return {
    sessionID: forkedSession.id,
    wasResumed: true,
    wasForked: true,
  };
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
    // Check if we should resume an existing session
    const resumeInfo = await resolveResumeSession(argv, compactJson);

    let sessionID;

    if (resumeInfo) {
      // Use the resumed/forked session
      sessionID = resumeInfo.sessionID;
    } else {
      // Create a new session
      const createRes = await fetch(
        `http://${server.hostname}:${server.port}/session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const session = await createRes.json();
      sessionID = session.id;

      if (!sessionID) {
        throw new Error('Failed to create session');
      }
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
    // Check if we should resume an existing session
    const resumeInfo = await resolveResumeSession(argv, compactJson);

    let sessionID;

    if (resumeInfo) {
      // Use the resumed/forked session
      sessionID = resumeInfo.sessionID;
    } else {
      // Create a new session directly
      const session = await Session.createNext({
        directory: process.cwd(),
      });
      sessionID = session.id;
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
