import { test, expect, describe } from 'bun:test';
import { config } from '../../src/flag/agent-config.ts';

describe('Generate Title Flag', () => {
  test('GENERATE_TITLE is false by default', () => {
    // Should be false by default to save tokens
    expect(config.generateTitle).toBe(false);
  });

  test('setGenerateTitle enables title generation', () => {
    // Save original value
    const original = config.generateTitle;

    // Enable
    config.generateTitle = true;
    expect(config.generateTitle).toBe(true);

    // Restore
    config.generateTitle = original;
  });

  test('setGenerateTitle disables title generation', () => {
    // Save original value
    const original = config.generateTitle;

    // Enable then disable
    config.generateTitle = true;
    config.generateTitle = false;
    expect(config.generateTitle).toBe(false);

    // Restore
    config.generateTitle = original;
  });
});

describe('Retry Timeout Flag', () => {
  test('RETRY_TIMEOUT returns default value (7 days)', () => {
    const timeout = config.retryTimeout;
    expect(timeout).toBe(604800); // 7 days in seconds
  });

  test('MAX_RETRY_DELAY returns default value (20 minutes)', () => {
    const maxDelay = config.maxRetryDelay * 1000;
    expect(maxDelay).toBe(1200000); // 20 minutes in ms
  });
});
