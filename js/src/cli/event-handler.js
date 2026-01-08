/**
 * Shared event handler logic for bus events.
 * Used by both single-message mode (index.js) and continuous mode (continuous-mode.js).
 */

import { Bus } from '../bus/index.ts';

/**
 * Create a subscription for session bus events that outputs events in the selected JSON format.
 * Returns an object with the unsubscribe function and a promise that resolves when session becomes idle.
 *
 * @param {object} options - Configuration options
 * @param {string} options.sessionID - The session ID to filter events
 * @param {object} options.eventHandler - The event handler (from createEventHandler)
 * @param {function} options.onError - Callback when error occurs (sets hasError flag)
 * @returns {{ unsub: function, idlePromise: Promise<void> }}
 */
export function createBusEventSubscription({
  sessionID,
  eventHandler,
  onError,
}) {
  let idleResolve;
  const idlePromise = new Promise((resolve) => {
    idleResolve = resolve;
  });

  const unsub = Bus.subscribeAll((event) => {
    // Output events in selected JSON format
    if (event.type === 'message.part.updated') {
      const part = event.properties.part;
      if (part.sessionID !== sessionID) {
        return;
      }

      // Output different event types
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

    // Handle session idle to know when to stop
    if (
      event.type === 'session.idle' &&
      event.properties.sessionID === sessionID
    ) {
      idleResolve();
    }

    // Handle errors
    if (event.type === 'session.error') {
      const props = event.properties;
      if (props.sessionID !== sessionID || !props.error) {
        return;
      }
      onError();
      eventHandler.output({
        type: 'error',
        timestamp: Date.now(),
        sessionID,
        error: props.error,
      });
    }
  });

  return { unsub, idlePromise };
}
