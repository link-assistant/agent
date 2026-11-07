import { describe, it, expect } from 'test-anywhere';

import {
  NON_RETRYABLE_PATTERNS,
  buildAuthFailureGuidance,
  isNonRetryableFailure,
} from '../scripts/publish-failure-classifier.mjs';

describe('publish failure classifier', () => {
  it('classifies a first-publish E404 as non-retryable', () => {
    const output = [
      'npm error code E404',
      'npm error 404 Not Found - PUT https://registry.npmjs.org/@scope%2fpkg',
      "The requested resource '@scope/pkg@0.8.1' could not be found",
    ].join('\n');

    expect(isNonRetryableFailure(output)).toBe(true);
  });

  it('classifies authentication failures (401/403/auth) as non-retryable', () => {
    expect(isNonRetryableFailure('npm error 401 Unauthorized')).toBe(true);
    expect(isNonRetryableFailure('npm error 403 Forbidden')).toBe(true);
    expect(isNonRetryableFailure('npm error code E401')).toBe(true);
    expect(isNonRetryableFailure('npm error code E403')).toBe(true);
    expect(isNonRetryableFailure('Access token expired')).toBe(true);
    expect(isNonRetryableFailure('npm ERR! need auth ENEEDAUTH')).toBe(true);
    expect(
      isNonRetryableFailure('You must be logged in to publish packages')
    ).toBe(true);
    expect(isNonRetryableFailure('Unable to authenticate, your token')).toBe(
      true
    );
  });

  it('is case-insensitive when matching patterns', () => {
    expect(isNonRetryableFailure('NPM ERROR 404 NOT FOUND')).toBe(true);
    expect(isNonRetryableFailure('ACCESS TOKEN EXPIRED')).toBe(true);
  });

  it('treats transient/unknown failures as retryable', () => {
    expect(isNonRetryableFailure('')).toBe(false);
    expect(isNonRetryableFailure('ETIMEDOUT request to registry')).toBe(false);
    expect(isNonRetryableFailure('npm error code ECONNRESET')).toBe(false);
    expect(
      isNonRetryableFailure('Package not found on npm after publish attempt')
    ).toBe(false);
  });

  it('handles null/undefined input without throwing', () => {
    expect(isNonRetryableFailure(null)).toBe(false);
    expect(isNonRetryableFailure(undefined)).toBe(false);
  });

  it('exposes the documented non-retryable patterns', () => {
    for (const pattern of [
      'npm error 404',
      'npm error 401',
      'npm error 403',
      'e404',
      'e401',
      'e403',
      'access token expired',
      'eneedauth',
      'you must be logged in',
      'unable to authenticate',
    ]) {
      expect(NON_RETRYABLE_PATTERNS).toContain(pattern);
    }
  });

  it('builds actionable guidance naming the package and the bootstrap token', () => {
    const guidance = buildAuthFailureGuidance('@scope/pkg');

    expect(guidance).toContain('@scope/pkg');
    expect(guidance).toContain('NPM_TOKEN');
    expect(guidance).toContain('NODE_AUTH_TOKEN');
    expect(guidance.toLowerCase()).toContain('trusted publish');
    expect(guidance).toContain('https://docs.npmjs.com/trusted-publishers');
  });
});
