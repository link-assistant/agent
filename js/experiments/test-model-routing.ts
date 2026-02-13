/**
 * Test script for model routing logic
 * Tests the new parseModelWithResolution and resolveShortModelName functions
 *
 * Run with: bun run experiments/test-model-routing.ts
 */

import { Provider } from '../src/provider/provider';
import { Instance } from '../src/project/instance';

async function testModelRouting() {
  console.log('=== Model Routing Tests ===\n');

  // Debug: Check what providers are available
  const providers = await Provider.list();
  console.log('Available providers:', Object.keys(providers));
  for (const [id, p] of Object.entries(providers)) {
    const modelKeys = Object.keys(p.info.models);
    console.log(
      `  ${id}: ${modelKeys.length} models - ${modelKeys.slice(0, 5).join(', ')}${modelKeys.length > 5 ? '...' : ''}`
    );
    if (modelKeys.includes('minimax-m2.1-free')) {
      console.log(`    ↳ has minimax-m2.1-free`);
    }
  }
  console.log('');

  const testCases = [
    // Explicit provider tests
    {
      input: 'kilo/glm-5-free',
      expectedProvider: 'kilo',
      expectedModel: 'glm-5-free',
      description: 'Explicit kilo provider',
    },
    {
      input: 'opencode/kimi-k2.5-free',
      expectedProvider: 'opencode',
      expectedModel: 'kimi-k2.5-free',
      description: 'Explicit opencode provider',
    },
    {
      input: 'kilo/kimi-k2.5-free',
      expectedProvider: 'kilo',
      expectedModel: 'kimi-k2.5-free',
      description: 'Explicit kilo with shared model',
    },

    // Short model name tests (unique to Kilo)
    {
      input: 'glm-5-free',
      expectedProvider: 'kilo',
      expectedModel: 'glm-5-free',
      description: 'Short name - GLM-5 (Kilo unique)',
    },
    {
      input: 'glm-4.7-free',
      expectedProvider: 'kilo',
      expectedModel: 'glm-4.7-free',
      description: 'Short name - GLM-4.7 (Kilo unique)',
    },

    // Short model name tests (shared models - prefer OpenCode)
    {
      input: 'kimi-k2.5-free',
      expectedProvider: 'opencode',
      expectedModel: 'kimi-k2.5-free',
      description: 'Short name - Kimi K2.5 (shared, prefer OpenCode)',
    },
    // Note: minimax-m2.1-free is ONLY in Kilo (OpenCode has minimax-m2.5-free instead)
    {
      input: 'minimax-m2.1-free',
      expectedProvider: 'kilo',
      expectedModel: 'minimax-m2.1-free',
      description: 'Short name - MiniMax M2.1 (Kilo unique)',
    },
    // Test OpenCode's minimax variant
    {
      input: 'minimax-m2.5-free',
      expectedProvider: 'opencode',
      expectedModel: 'minimax-m2.5-free',
      description: 'Short name - MiniMax M2.5 (OpenCode unique)',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    try {
      const result = await Provider.parseModelWithResolution(test.input);
      const success =
        result.providerID === test.expectedProvider &&
        result.modelID === test.expectedModel;

      if (success) {
        console.log(`✅ ${test.description}`);
        console.log(
          `   Input: "${test.input}" -> Provider: "${result.providerID}", Model: "${result.modelID}"`
        );
        passed++;
      } else {
        console.log(`❌ ${test.description}`);
        console.log(`   Input: "${test.input}"`);
        console.log(
          `   Expected: Provider: "${test.expectedProvider}", Model: "${test.expectedModel}"`
        );
        console.log(
          `   Got: Provider: "${result.providerID}", Model: "${result.modelID}"`
        );
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.description}`);
      console.log(`   Input: "${test.input}"`);
      console.log(
        `   Error: ${error instanceof Error ? error.message : String(error)}`
      );
      failed++;
    }
    console.log();
  }

  console.log('=== Test Summary ===');
  console.log(`Passed: ${passed}/${testCases.length}`);
  console.log(`Failed: ${failed}/${testCases.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Test rate limit alternatives
async function testRateLimitAlternatives() {
  console.log('\n=== Rate Limit Alternative Tests ===\n');

  const testCases = [
    // Shared model, no explicit provider - should have alternatives
    {
      modelID: 'kimi-k2.5-free',
      failedProviderID: 'opencode',
      wasExplicit: false,
      expectAlternatives: ['kilo'],
      description: 'Shared model without explicit provider',
    },
    // Shared model, explicit provider - should NOT have alternatives
    {
      modelID: 'kimi-k2.5-free',
      failedProviderID: 'opencode',
      wasExplicit: true,
      expectAlternatives: [],
      description: 'Shared model with explicit provider (no fallback)',
    },
    // Unique model - should NOT have alternatives
    {
      modelID: 'glm-5-free',
      failedProviderID: 'kilo',
      wasExplicit: false,
      expectAlternatives: [],
      description: 'Unique model (no alternatives available)',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    try {
      const alternatives = await Provider.getAlternativeProviders(
        test.modelID,
        test.failedProviderID,
        test.wasExplicit
      );

      const expected = JSON.stringify(test.expectAlternatives.sort());
      const actual = JSON.stringify(alternatives.sort());
      const success = expected === actual;

      if (success) {
        console.log(`✅ ${test.description}`);
        console.log(
          `   Alternatives: ${alternatives.length > 0 ? alternatives.join(', ') : '(none)'}`
        );
        passed++;
      } else {
        console.log(`❌ ${test.description}`);
        console.log(
          `   Expected alternatives: ${test.expectAlternatives.join(', ') || '(none)'}`
        );
        console.log(
          `   Got alternatives: ${alternatives.join(', ') || '(none)'}`
        );
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.description}`);
      console.log(
        `   Error: ${error instanceof Error ? error.message : String(error)}`
      );
      failed++;
    }
    console.log();
  }

  console.log('=== Alternative Tests Summary ===');
  console.log(`Passed: ${passed}/${testCases.length}`);
  console.log(`Failed: ${failed}/${testCases.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
async function main() {
  console.log('Model Routing Test Suite\n');
  console.log('This test verifies the model routing logic for issue #165.\n');

  // Get current directory for Instance.provide
  const directory = process.cwd();

  // Run tests inside Instance.provide context (required for provider state)
  await Instance.provide({
    directory,
    fn: async () => {
      await testModelRouting();
      await testRateLimitAlternatives();
    },
  });

  console.log('\n✅ All tests passed!');
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
