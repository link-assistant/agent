#!/usr/bin/env node
/**
 * Test script for model providers - simple message without tool calls
 * Usage: node scripts/test-model-simple.mjs <model-id>
 * Example: node scripts/test-model-simple.mjs groq/llama-3.3-70b-versatile
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const modelId = process.argv[2];
if (!modelId) {
  console.error('Error: Model ID is required');
  console.error('Usage: node scripts/test-model-simple.mjs <model-id>');
  process.exit(1);
}

console.log(`Testing model: ${modelId}`);
console.log('Test type: Simple message (no tool calls expected)');
console.log('');

// Check for API key if using Groq
if (modelId.startsWith('groq/') && !process.env.GROQ_API_KEY) {
  console.warn('⚠️  Warning: GROQ_API_KEY is not set. This test may fail.');
  console.warn('Set it with: export GROQ_API_KEY=your_api_key_here');
  console.warn('');
}

// Create test input - simple question that shouldn't require tools
const testInput = JSON.stringify({
  message: 'What is 2 + 2? Answer with just the number.'
});

console.log(`Input: ${testInput}`);
console.log('');

// Models with low token limits that need minimal system messages
// These models have ~6000 TPM limits on free tiers which can't accommodate
// the full default system message (~12,000 tokens)
const lowLimitModels = [
  'qwen3-32b',
  'mixtral-8x7b-32768',
];

const needsMinimalSystem = lowLimitModels.some(model => modelId.includes(model));

// Minimal system message for low-limit models (optimized for token efficiency)
const minimalSystemMessage = 'You are a helpful AI assistant. Answer questions accurately and concisely.';

if (needsMinimalSystem) {
  console.log('ℹ️  Using minimal system message (low token limit model detected)');
  console.log('');
}

console.log('Running test...');
console.log('');

const logFile = join(projectRoot, 'test-output-simple.log');
const logStream = createWriteStream(logFile);

// Build command arguments
const args = ['run', join(projectRoot, 'src/index.js'), '--model', modelId];

// Add minimal system message for low-limit models
if (needsMinimalSystem) {
  args.push('--system-message', minimalSystemMessage);
}

// Run the agent
const agent = spawn('bun', args, {
  cwd: projectRoot,
  env: process.env,
});

// Write input to stdin
agent.stdin.write(testInput);
agent.stdin.end();

// Capture output
let output = '';
agent.stdout.on('data', (data) => {
  const chunk = data.toString();
  output += chunk;
  logStream.write(chunk);
  process.stdout.write(chunk);
});

agent.stderr.on('data', (data) => {
  const chunk = data.toString();
  output += chunk;
  logStream.write(chunk);
  process.stderr.write(chunk);
});

// Set timeout
const timeout = setTimeout(() => {
  agent.kill();
  console.error('');
  console.error('⚠️  Test TIMEOUT: Agent took too long');
  logStream.end();
  process.exit(124);
}, 60000);

agent.on('close', (code) => {
  clearTimeout(timeout);
  logStream.end();

  console.log('');
  console.log(`Exit code: ${code}`);

  // Check for errors in output (even if exit code is 0)
  const errorPatterns = [
    /\w+Error:/,           // Any JavaScript error (TypeError, ReferenceError, etc.)
    /Error:/,              // Generic "Error:"
    /Exception:/,          // Exceptions
    /ENOENT/,              // File not found
    /ECONNREFUSED/,        // Connection refused
  ];

  const hasError = errorPatterns.some(pattern => pattern.test(output));

  if (hasError) {
    console.log('');
    console.log('❌ Test FAILED: Error detected in output');
    process.exit(1);
  }

  if (code === 0) {
    console.log('');
    console.log('✅ Test PASSED: Agent completed successfully');

    // Check if response contains "4"
    if (output.includes('"4"') || output.includes(': 4') || output.includes('"text":"4"')) {
      console.log('✅ Response validation: Contains expected answer \'4\'');
    } else {
      console.log('⚠️  Response may not contain the expected answer \'4\'');
    }
    process.exit(0);
  } else {
    console.log('');
    console.log(`❌ Test FAILED: Agent exited with code ${code}`);
    process.exit(code || 1);
  }
});

agent.on('error', (err) => {
  clearTimeout(timeout);
  logStream.end();
  console.error('');
  console.error(`❌ Error running agent: ${err.message}`);
  process.exit(1);
});
