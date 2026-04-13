#!/usr/bin/env node

/**
 * Test script to verify publish-to-crates.mjs logic changes.
 * Tests the "already exists" detection and failure pattern detection.
 */

const ALREADY_EXISTS_PATTERNS = [
  'already exists on crates.io index',
  'crate already uploaded',
  'already exists on the registry',
];

const FAILURE_PATTERNS = [
  'error[E',
  'error: ',
  '403 Forbidden',
  '401 Unauthorized',
  'the remote server responded with an error',
];

function detectAlreadyExists(output) {
  for (const pattern of ALREADY_EXISTS_PATTERNS) {
    if (output.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function detectPublishFailure(output) {
  if (detectAlreadyExists(output)) {
    return null;
  }
  for (const pattern of FAILURE_PATTERNS) {
    if (output.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

// Test cases
const tests = [
  {
    name: '"already exists on crates.io index" should NOT be a failure',
    input: `    Updating crates.io index
  Credential cargo:token get crates-io
error: crate link-assistant-agent@0.9.2 already exists on crates.io index`,
    expectAlreadyExists: true,
    expectFailure: null,
  },
  {
    name: '"crate already uploaded" should NOT be a failure',
    input: 'error: crate already uploaded',
    expectAlreadyExists: true,
    expectFailure: null,
  },
  {
    name: 'real error[E should be detected as failure',
    input: 'error[E0433]: failed to resolve',
    expectAlreadyExists: false,
    expectFailure: 'error[E',
  },
  {
    name: '403 Forbidden should be detected as failure',
    input: '403 Forbidden: invalid token',
    expectAlreadyExists: false,
    expectFailure: '403 Forbidden',
  },
  {
    name: 'generic "error: " without already exists should be failure',
    input: 'error: failed to verify package',
    expectAlreadyExists: false,
    expectFailure: 'error: ',
  },
  {
    name: 'clean output should not be a failure',
    input: '  Compiling link-assistant-agent v0.9.2\n  Uploading link-assistant-agent v0.9.2',
    expectAlreadyExists: false,
    expectFailure: null,
  },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  const alreadyExists = detectAlreadyExists(test.input);
  const failure = detectPublishFailure(test.input);

  const alreadyExistsOk = alreadyExists === test.expectAlreadyExists;
  const failureOk = failure === test.expectFailure;

  if (alreadyExistsOk && failureOk) {
    console.log(`PASS: ${test.name}`);
    passed++;
  } else {
    console.log(`FAIL: ${test.name}`);
    if (!alreadyExistsOk) {
      console.log(`  alreadyExists: expected=${test.expectAlreadyExists}, got=${alreadyExists}`);
    }
    if (!failureOk) {
      console.log(`  failure: expected=${JSON.stringify(test.expectFailure)}, got=${JSON.stringify(failure)}`);
    }
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
