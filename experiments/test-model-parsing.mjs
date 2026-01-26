#!/usr/bin/env node
/**
 * Test script to verify model parsing logic
 */

// Old buggy implementation
function parseModelOld(model) {
  const modelParts = model.split('/');
  const providerID = modelParts[0] || 'opencode';
  const modelID = modelParts[1] || 'grok-code';
  return { providerID, modelID };
}

// New fixed implementation
function parseModelNew(model) {
  const modelParts = model.split('/');
  const providerID = modelParts[0] || 'opencode';
  const modelID = modelParts.slice(1).join('/') || 'grok-code';
  return { providerID, modelID };
}

// Test cases
const testCases = [
  {
    input: 'groq/qwen/qwen3-32b',
    expected: { providerID: 'groq', modelID: 'qwen/qwen3-32b' },
  },
  {
    input: 'groq/llama-3.3-70b-versatile',
    expected: { providerID: 'groq', modelID: 'llama-3.3-70b-versatile' },
  },
  {
    input: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
    expected: {
      providerID: 'groq',
      modelID: 'meta-llama/llama-4-scout-17b-16e-instruct',
    },
  },
  {
    input: 'opencode/gpt-5',
    expected: { providerID: 'opencode', modelID: 'gpt-5' },
  },
];

console.log('Testing Model Parsing Logic\n');
console.log('='.repeat(80));

let oldFailed = 0;
let newFailed = 0;

for (const testCase of testCases) {
  console.log(`\nInput: ${testCase.input}`);
  console.log(
    `Expected: providerID="${testCase.expected.providerID}", modelID="${testCase.expected.modelID}"`
  );

  const oldResult = parseModelOld(testCase.input);
  const newResult = parseModelNew(testCase.input);

  const oldMatch =
    oldResult.providerID === testCase.expected.providerID &&
    oldResult.modelID === testCase.expected.modelID;
  const newMatch =
    newResult.providerID === testCase.expected.providerID &&
    newResult.modelID === testCase.expected.modelID;

  console.log(
    `Old impl: providerID="${oldResult.providerID}", modelID="${oldResult.modelID}" ${oldMatch ? '✅' : '❌'}`
  );
  console.log(
    `New impl: providerID="${newResult.providerID}", modelID="${newResult.modelID}" ${newMatch ? '✅' : '❌'}`
  );

  if (!oldMatch) {
    oldFailed++;
  }
  if (!newMatch) {
    newFailed++;
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log(`\nResults:`);
console.log(
  `Old implementation: ${testCases.length - oldFailed}/${testCases.length} passed, ${oldFailed} failed`
);
console.log(
  `New implementation: ${testCases.length - newFailed}/${testCases.length} passed, ${newFailed} failed`
);

if (newFailed === 0) {
  console.log('\n✅ All tests passed with new implementation!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed with new implementation');
  process.exit(1);
}
