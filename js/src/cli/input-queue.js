/**
 * Input queue for managing continuous stdin input.
 * Supports queuing of multiple messages and auto-merging of rapidly arriving lines.
 */
export class InputQueue {
  constructor(options = {}) {
    this.queue = [];
    this.inputFormat = options.inputFormat || 'text';
    this.autoMerge = options.autoMerge !== false; // enabled by default
    this.mergeDelayMs = options.mergeDelayMs || 50; // delay to wait for more lines
    this.pendingLines = [];
    this.mergeTimer = null;
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});
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

    if (this.inputFormat === 'stream-json') {
      return parseStreamJsonInput(trimmed);
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
    if (this.inputFormat === 'stream-json') {
      this.queueLine(line);
      return;
    }

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
      this.queueLine(line);
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
   * Notify listener of an input parse error
   * @param {Error} error - Parse error
   * @param {string} line - Raw input line
   */
  notifyError(error, line) {
    if (this.onError) {
      this.onError(error, line);
    }
  }

  /**
   * Parse and enqueue one complete input line
   * @param {string} line - Raw input line
   */
  queueLine(line) {
    try {
      const parsed = this.parseInput(line);
      if (parsed) {
        this.queue.push(parsed);
        this.notifyMessage(parsed);
      }
    } catch (error) {
      this.notifyError(error, line);
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

function extractContentText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part === 'object') {
        if (typeof part.text === 'string') {
          parts.push(part.text);
        } else if (typeof part.content === 'string') {
          parts.push(part.content);
        }
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      return content.text;
    }
    if ('content' in content) {
      return extractContentText(content.content);
    }
  }

  return null;
}

function extractFrameText(frame) {
  if (typeof frame.message === 'string') {
    return frame.message;
  }

  if (frame.message && typeof frame.message === 'object') {
    const messageText = extractContentText(frame.message.content);
    if (messageText !== null) {
      return messageText;
    }
    if (typeof frame.message.text === 'string') {
      return frame.message.text;
    }
  }

  const contentText = extractContentText(frame.content);
  if (contentText !== null) {
    return contentText;
  }

  if (typeof frame.text === 'string') {
    return frame.text;
  }

  return null;
}

/**
 * Parse one Claude-compatible stream-json input frame.
 * @param {string} input - One JSONL frame
 * @returns {object} Normalized queue message
 */
export function parseStreamJsonInput(input) {
  let frame;
  try {
    frame = JSON.parse(input);
  } catch (error) {
    throw new Error(
      `Invalid stream-json input frame: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    throw new Error('Invalid stream-json input frame: expected JSON object');
  }

  const type = frame.type;

  if (type === 'interrupt') {
    return {
      kind: 'interrupt',
      raw: input,
      parsed: frame,
      format: 'stream-json',
      inputType: type,
    };
  }

  if (type === 'system') {
    const system = extractFrameText(frame);
    if (system === null) {
      throw new Error(
        'Invalid stream-json system frame: expected content text'
      );
    }
    return {
      kind: 'system',
      system,
      raw: input,
      parsed: frame,
      format: 'stream-json',
      inputType: type,
    };
  }

  if (type === 'user' || type === 'user_prompt' || type === undefined) {
    const message = extractFrameText(frame);
    if (message === null) {
      throw new Error(
        'Invalid stream-json user frame: expected message content text'
      );
    }
    return {
      kind: 'message',
      message,
      raw: input,
      parsed: frame,
      format: 'stream-json',
      inputType: type || 'message',
    };
  }

  throw new Error(`Unsupported stream-json input frame type: ${String(type)}`);
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

  const handleError = () => {
    isRunning = false;
  };

  process.stdin.on('data', handleData);
  process.stdin.on('end', handleEnd);
  process.stdin.on('error', handleError);

  return {
    queue: inputQueue,
    stop: () => {
      isRunning = false;
      inputQueue.flush();
      process.stdin.removeListener('data', handleData);
      process.stdin.removeListener('end', handleEnd);
      process.stdin.removeListener('error', handleError);
    },
    isRunning: () => isRunning,
  };
}
