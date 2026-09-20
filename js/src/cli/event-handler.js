/**
 * Shared event handler logic for bus events.
 * Used by both single-message mode (index.js) and continuous mode (continuous-mode.js).
 */

import { Bus } from '../bus/index.ts';
import { errorText } from '../util/error-text.ts';

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
    outputBusEvent({
      event,
      sessionID,
      eventHandler,
      onError,
      onIdle: idleResolve,
    });
  });

  return { unsub, idlePromise };
}

export function outputBusEvent({
  event,
  sessionID,
  eventHandler,
  onError,
  onIdle,
}) {
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

    if (part.type === 'tool') {
      eventHandler.output({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID,
        part,
      });

      // If tool failed, also output an error event
      if (part.state?.status === 'error') {
        const stateError = part.state.error;
        eventHandler.output({
          type: 'error',
          timestamp: Date.now(),
          sessionID,
          part,
          message: errorText(stateError, 'Tool execution failed'),
          error: stateError || 'Tool execution failed',
        });
      }
    }
  }

  // Emit a JSON permission request when a tool needs approval (issue #271).
  // The consumer replies with a `permission_response` frame over stdin which
  // is routed to Permission.respond. No TUI is involved.
  if (event.type === 'permission.updated') {
    const permission = event.properties;
    if (permission.sessionID !== sessionID) {
      return;
    }
    eventHandler.output({
      type: 'permission_request',
      timestamp: Date.now(),
      sessionID,
      permissionID: permission.id,
      callID: permission.callID,
      tool: permission.type,
      pattern: permission.pattern,
      title: permission.title,
      metadata: permission.metadata,
    });
  }

  // Handle session idle to know when to stop
  if (
    event.type === 'session.idle' &&
    event.properties.sessionID === sessionID
  ) {
    eventHandler.output({
      type: 'session_idle',
      timestamp: Date.now(),
      sessionID,
    });
    onIdle?.();
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
      message: errorText(props.error),
      error: props.error,
    });
  }
}
