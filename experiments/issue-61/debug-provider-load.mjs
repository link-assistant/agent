#!/usr/bin/env bun
/**
 * Debug script to trace provider loading
 */

// Mock env
process.env.GEMINI_API_KEY = 'test-fake-key';

// Fetch the models.dev database
const response = await fetch('https://models.dev/api.json', {
  headers: {
    'User-Agent': 'agent-cli/1.0.0',
  },
});
const database = await response.json();

console.log('=== Google Provider from models.dev ===');
const google = database['google'];
console.log('ID:', google.id);
console.log('Name:', google.name);
console.log('NPM:', google.npm);
console.log('Env:', google.env);
console.log('Number of models:', Object.keys(google.models).length);
console.log(
  'Has gemini-3-pro-preview:',
  !!google.models['gemini-3-pro-preview']
);

console.log('\n=== Checking env vars ===');
console.log(
  'GOOGLE_GENERATIVE_AI_API_KEY:',
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ? '(set)' : '(not set)'
);
console.log(
  'GEMINI_API_KEY:',
  process.env.GEMINI_API_KEY ? '(set)' : '(not set)'
);

console.log('\n=== Simulating provider loading ===');
const apiKey = google.env.map((item) => process.env[item]).find(Boolean);
console.log('Found API key:', apiKey ? '(yes)' : '(no)');

if (apiKey) {
  console.log('\n=== Google provider WOULD be loaded with options: ===');
  console.log({ apiKey: '***' });
} else {
  console.log('\n=== Google provider would NOT be loaded (no API key) ===');
}

// Check model status
console.log('\n=== Model Status Analysis ===');
const gemini3Pro = google.models['gemini-3-pro-preview'];
console.log('gemini-3-pro-preview:');
console.log('  - experimental:', gemini3Pro.experimental);
console.log('  - status:', gemini3Pro.status);

// Would it be filtered out?
const wouldBeFiltered =
  (gemini3Pro.experimental || gemini3Pro.status === 'alpha') &&
  !process.env.OPENCODE_ENABLE_EXPERIMENTAL_MODELS;
console.log('  - would be filtered:', wouldBeFiltered);
