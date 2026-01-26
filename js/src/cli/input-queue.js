/**
 * Input queue for managing continuous stdin input.
 * Supports queuing of multiple messages and auto-merging of rapidly arriving lines.
 */
export class InputQueue {
  constructor(options = {}) {
    this.queue = [];
    this.autoMerge = options.autoMerge !== false; // enabled by default
    this.mergeDelayMs = options.mergeDelayMs || 50; // delay to wait for more lines
    this.pendingLines = [];
    this.mergeTimer = null;
    this.onMessage = options.onMessage || (() => {});
    this.interactive = options.interactive !== false; // enabled by default
  }

  /**
   * Parse input and determine if it's JSON or plain text
   * @param {string} input - Raw input string
   * @returns {object} - Parsed message object
   */
  parseInput(input) {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      // If it has a message field, use it directly
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
      // Otherwise wrap it
      return { message: JSON.stringify(parsed) };
    } catch (_e) {
      // Not JSON, treat as plain text message
      return { message: trimmed };
    }
  }

  /**
   * Add a line to the queue, potentially merging with pending lines
   * @param {string} line - Input line
   */
  addLine(line) {
    if (!this.interactive && !line.trim().startsWith('{')) {
      // In non-interactive mode, only accept JSON
      return;
    }

    if (this.autoMerge) {
      // Add to pending lines and schedule merge
      this.pendingLines.push(line);
      this.scheduleMerge();
    } else {
      // No merging, queue immediately
      const parsed = this.parseInput(line);
      if (parsed) {
        this.queue.push(parsed);
        this.notifyMessage(parsed);
      }
    }
  }

  /**
   * Schedule a merge of pending lines after a short delay
   */
  scheduleMerge() {
    if (this.mergeTimer) {
      clearTimeout(this.mergeTimer);
    }
    this.mergeTimer = setTimeout(() => {
      this.flushPendingLines();
    }, this.mergeDelayMs);
  }

  /**
   * Flush pending lines into a single merged message
   */
  flushPendingLines() {
    if (this.pendingLines.length === 0) {
      return;
    }

    const mergedText = this.pendingLines.join('\n');
    this.pendingLines = [];
    this.mergeTimer = null;

    const parsed = this.parseInput(mergedText);
    if (parsed) {
      this.queue.push(parsed);
      this.notifyMessage(parsed);
    }
  }

  /**
   * Immediately flush any pending lines (for shutdown)
   */
  flush() {
    if (this.mergeTimer) {
      clearTimeout(this.mergeTimer);
      this.mergeTimer = null;
    }
    this.flushPendingLines();
  }

  /**
   * Get next message from the queue
   * @returns {object|null} - Next message or null if queue is empty
   */
  dequeue() {
    return this.queue.shift() || null;
  }

  /**
   * Check if queue has messages
   * @returns {boolean}
   */
  hasMessages() {
    return this.queue.length > 0;
  }

  /**
   * Notify listener of new message
   * @param {object} message - The message object
   */
  notifyMessage(message) {
    if (this.onMessage) {
      this.onMessage(message);
    }
  }

  /**
   * Get queue size
   * @returns {number}
   */
  size() {
    return this.queue.length;
  }
}

/**
 * Create a continuous stdin reader that queues input lines
 * @param {object} options - Options for the reader
 * @returns {object} - Reader with queue and control methods
 */
// Note: This function is prepared for future continuous input mode
export function createContinuousStdinReader(options = {}) {
  const inputQueue = new InputQueue(options);
  let isRunning = true;
  let lineBuffer = '';

  const handleData = (chunk) => {
    if (!isRunning) {
      return;
    }

    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');

    // Keep the last incomplete line in buffer
    lineBuffer = lines.pop() || '';

    // Process complete lines
    for (const line of lines) {
      if (line.trim()) {
        inputQueue.addLine(line);
      }
    }
  };

  const handleEnd = () => {
    // Process any remaining data in buffer
    if (lineBuffer.trim()) {
      inputQueue.addLine(lineBuffer);
    }
    inputQueue.flush();
    isRunning = false;
  };

  process.stdin.on('data', handleData);
  process.stdin.on('end', handleEnd);
  process.stdin.on('error', () => {
    isRunning = false;
  });

  return {
    queue: inputQueue,
    stop: () => {
      isRunning = false;
      inputQueue.flush();
      process.stdin.removeListener('data', handleData);
      process.stdin.removeListener('end', handleEnd);
    },
    isRunning: () => isRunning,
  };
}
