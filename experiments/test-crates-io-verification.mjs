#!/usr/bin/env node

/**
 * Test script for crates.io verification logic used in publish-to-crates.mjs
 *
 * Tests:
 * 1. Checking a crate that exists (e.g., serde)
 * 2. Checking a crate that doesn't exist
 * 3. Checking a specific version that exists
 * 4. Checking a specific version that doesn't exist
 * 5. Verifying the link-assistant-agent crate status
 */

async function checkCratesIo(packageName, version) {
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${packageName}/${version}`,
      {
        headers: { 'User-Agent': 'link-assistant-agent-ci-test' },
      }
    );
    if (response.ok) {
      const data = await response.json();
      return data.version && data.version.num === version;
    }
    return false;
  } catch {
    return false;
  }
}

async function checkCrateExists(packageName) {
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${packageName}`,
      {
        headers: { 'User-Agent': 'link-assistant-agent-ci-test' },
      }
    );
    if (response.ok) {
      const data = await response.json();
      return {
        exists: true,
        versions: (data.versions || []).map((v) => v.num),
      };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

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

async function main() {
  console.log('Testing crates.io verification logic...\n');

  // Test 1: Known existing crate
  console.log('Test 1: Check existing crate (serde)');
  const serdeInfo = await checkCrateExists('serde');
  assert(serdeInfo.exists, 'serde exists on crates.io');
  assert(serdeInfo.versions.length > 0, 'serde has published versions');

  // Test 2: Non-existing crate
  console.log('\nTest 2: Check non-existing crate');
  const fakeInfo = await checkCrateExists(
    'this-crate-definitely-does-not-exist-xyz-123'
  );
  assert(!fakeInfo.exists, 'fake crate does not exist');

  // Test 3: Specific version that exists
  console.log('\nTest 3: Check existing version (serde@1.0.0)');
  const serdeVersionExists = await checkCratesIo('serde', '1.0.0');
  assert(serdeVersionExists, 'serde@1.0.0 exists');

  // Test 4: Specific version that doesn't exist
  console.log('\nTest 4: Check non-existing version (serde@999.999.999)');
  const serdeVersionMissing = await checkCratesIo('serde', '999.999.999');
  assert(!serdeVersionMissing, 'serde@999.999.999 does not exist');

  // Test 5: Check link-assistant-agent (should not exist yet)
  console.log('\nTest 5: Check link-assistant-agent crate');
  const laInfo = await checkCrateExists('link-assistant-agent');
  console.log(
    `  link-assistant-agent exists: ${laInfo.exists}, versions: ${laInfo.versions?.join(', ') || 'none'}`
  );

  // Test 6: Check old 'agent' crate (owned by someone else)
  console.log('\nTest 6: Check old agent crate (owned by different user)');
  const agentInfo = await checkCrateExists('agent');
  assert(agentInfo.exists, 'agent crate exists (owned by another user)');
  console.log(`  agent versions: ${agentInfo.versions?.join(', ')}`);

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
