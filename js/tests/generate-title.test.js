import { test, expect, describe } from 'bun:test';
import { Flag } from '../src/flag/flag.ts';

describe('Generate Title Flag', () => {
  test('GENERATE_TITLE is false by default', () => {
    // Should be false by default to save tokens
    expect(Flag.GENERATE_TITLE).toBe(false);
  });

  test('setGenerateTitle enables title generation', () => {
    // Save original value
    const original = Flag.GENERATE_TITLE;

    // Enable
    Flag.setGenerateTitle(true);
    expect(Flag.GENERATE_TITLE).toBe(true);

    // Restore
    Flag.setGenerateTitle(original);
  });

  test('setGenerateTitle disables title generation', () => {
    // Save original value
    const original = Flag.GENERATE_TITLE;

    // Enable then disable
    Flag.setGenerateTitle(true);
    Flag.setGenerateTitle(false);
    expect(Flag.GENERATE_TITLE).toBe(false);

    // Restore
    Flag.setGenerateTitle(original);
  });
});

describe('Retry Timeout Flag', () => {
  test('RETRY_TIMEOUT returns default value (7 days)', () => {
    const timeout = Flag.RETRY_TIMEOUT();
    expect(timeout).toBe(604800); // 7 days in seconds
  });

  test('MAX_RETRY_DELAY returns default value (20 minutes)', () => {
    const maxDelay = Flag.MAX_RETRY_DELAY();
    expect(maxDelay).toBe(1200000); // 20 minutes in ms
  });
});
