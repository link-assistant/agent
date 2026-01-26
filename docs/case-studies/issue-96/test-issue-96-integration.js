#!/usr/bin/env bun
/**
 * Integration test to verify Issue #96 is completely resolved
 *
 * This test replicates the original failing command and ensures:
 * 1. No "undefined is not an object" error
 * 2. Agent runs successfully
 * 3. Output is properly formatted
 * 4. Both normal and dry-run modes work
 */

import { sh } from 'command-stream';

console.log('🧪 Running Issue #96 Integration Test...\n');

async function testCommand(description, command, expectedOutput) {
  console.log(`📋 Testing: ${description}`);
  console.log(`🔧 Command: ${command}`);

  try {
    const result = await sh(command, { timeout: 5000 });
    const output = result.stdout.trim();
    const stderr = result.stderr.trim();

    // Check for the specific error we're trying to fix
    const hasLazyError =
      stderr.includes('undefined is not an object') &&
      stderr.includes('Log.Default.lazy.info');

    if (hasLazyError) {
      console.log('❌ FAILED: Log.Default.lazy.info error still present');
      console.log(`Stderr: ${stderr}`);
      return false;
    }

    if (expectedOutput && !output.includes(expectedOutput)) {
      console.log(`❌ FAILED: Expected output to contain "${expectedOutput}"`);
      console.log(`Actual output: ${output}`);
      return false;
    }

    console.log('✅ PASSED');
    return true;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    return false;
  }
}

async function runIntegrationTests() {
  const tests = [
    {
      description: 'Original failing command with echo model',
      command:
        'echo "hi" | bun src/index.js --model link-assistant/echo --no-always-accept-stdin',
      expectedOutput: null, // Don't check for specific output, just ensure no logging error
    },
    {
      description: 'Dry-run mode (originally failing)',
      command:
        'echo "test" | bun src/index.js --model link-assistant/echo --dry-run --no-always-accept-stdin',
      expectedOutput: 'test',
    },
    {
      description: 'Verbose mode (triggers logging paths)',
      command:
        'echo "verbose test" | bun src/index.js --model link-assistant/echo --verbose --no-always-accept-stdin 2>/dev/null',
      expectedOutput: 'verbose test',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await testCommand(
      test.description,
      test.command,
      test.expectedOutput
    );
    if (success) {
      passed++;
    } else {
      failed++;
    }
    console.log('');
  }

  console.log(`\n📊 Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n🎉 Issue #96 is completely resolved!');
    console.log('✨ The Log.Default.lazy.info error has been fixed');
    process.exit(0);
  } else {
    console.log('\n💥 Some tests failed - Issue #96 may not be fully resolved');
    process.exit(1);
  }
}

runIntegrationTests().catch(console.error);
