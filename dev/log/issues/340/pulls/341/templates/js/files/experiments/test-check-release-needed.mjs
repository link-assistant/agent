#!/usr/bin/env node

/**
 * Test script for check-release-needed.mjs
 *
 * Verifies the script produces correct outputs for different scenarios.
 * Uses child_process to run the script with different environment variables.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

function runScript(env = {}) {
  const tmpOutput = join(tmpdir(), `gh-output-${Date.now()}-${Math.random()}`);
  writeFileSync(tmpOutput, '');

  const fullEnv = {
    ...process.env,
    GITHUB_OUTPUT: tmpOutput,
    ...env,
  };

  try {
    const stdout = execSync('node scripts/check-release-needed.mjs', {
      encoding: 'utf-8',
      env: fullEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const outputContent = readFileSync(tmpOutput, 'utf-8');
    const outputs = {};
    for (const line of outputContent.trim().split('\n')) {
      if (line.includes('=')) {
        const [key, ...rest] = line.split('=');
        outputs[key] = rest.join('=');
      }
    }

    return { stdout, outputs, exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status,
      outputs: {},
    };
  } finally {
    try {
      rmSync(tmpOutput);
    } catch {
      // ignore cleanup errors
    }
  }
}

console.log('\n=== Test: check-release-needed.mjs ===\n');

console.log('Test 1: With changesets present');
{
  const result = runScript({ HAS_CHANGESETS: 'true' });
  assert(result.exitCode === 0, 'Script exits successfully');
  assert(result.outputs.should_release === 'true', 'should_release=true');
  assert(result.outputs.skip_bump === 'false', 'skip_bump=false');
}

console.log(
  '\nTest 2: No changesets, package "my-package" not on npm (self-healing)'
);
{
  const result = runScript({ HAS_CHANGESETS: 'false' });
  assert(result.exitCode === 0, 'Script exits successfully');
  assert(result.outputs.should_release === 'true', 'should_release=true');
  assert(result.outputs.skip_bump === 'true', 'skip_bump=true');
}

console.log('\nTest 3: No env var defaults to no changesets');
{
  const env = { ...process.env };
  delete env.HAS_CHANGESETS;
  const result = runScript(env);
  assert(result.exitCode === 0, 'Script exits successfully');
  assert(
    result.outputs.should_release === 'true',
    'should_release=true (unpublished)'
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
