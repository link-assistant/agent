#!/usr/bin/env bun
/**
 * Experiment script to debug the ProviderInitError with google/gemini-3-pro model
 * Issue: https://github.com/link-assistant/agent/issues/61
 *
 * The error occurs when trying to use `echo "hi" | agent --model google/gemini-3-pro`
 */

import os from 'os';
import path from 'path';

const DEBUG = true;

// The cache path where dynamic packages are installed
const CACHE_PATH = path.join(
  os.homedir(),
  '.cache',
  'opencode',
  'node_modules'
);

function debug(...args) {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

async function testGoogleProvider() {
  // Step 1: Check if the @ai-sdk/google package can be loaded
  debug('Step 1: Testing @ai-sdk/google package import...');

  try {
    const googlePkgPath = path.join(CACHE_PATH, '@ai-sdk', 'google');
    debug('  - Package path:', googlePkgPath);
    const { createGoogleGenerativeAI, google } = await import(googlePkgPath);
    debug('  - Successfully imported @ai-sdk/google');
    debug('  - createGoogleGenerativeAI:', typeof createGoogleGenerativeAI);
    debug('  - google:', typeof google);

    // Check all exports
    const mod = await import(googlePkgPath);
    debug('  - All exports:', Object.keys(mod));
  } catch (e) {
    console.error('Failed to import @ai-sdk/google:', e);
    return;
  }

  // Step 2: Check environment variables
  debug('Step 2: Checking environment variables...');
  const GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  debug(
    '  - GOOGLE_GENERATIVE_AI_API_KEY:',
    GOOGLE_GENERATIVE_AI_API_KEY ? '(set)' : '(not set)'
  );
  debug('  - GEMINI_API_KEY:', GEMINI_API_KEY ? '(set)' : '(not set)');

  // Step 3: Try to create provider without API key (should fail)
  debug('Step 3: Testing createGoogleGenerativeAI without API key...');
  try {
    const googlePkgPath = path.join(CACHE_PATH, '@ai-sdk', 'google');
    const { createGoogleGenerativeAI } = await import(googlePkgPath);
    const provider = createGoogleGenerativeAI({
      name: 'google',
    });
    debug('  - Provider created:', typeof provider);
    debug('  - Provider keys:', Object.keys(provider));

    // Try to get language model
    const model = provider.languageModel('gemini-3-pro-preview');
    debug('  - Model created:', typeof model);
    debug('  - Model id:', model.modelId);
  } catch (e) {
    console.error('Error creating provider without API key:', e.message);
    console.error('Stack:', e.stack);
  }

  // Step 4: Test with a fake API key
  debug('Step 4: Testing createGoogleGenerativeAI with fake API key...');
  try {
    const googlePkgPath = path.join(CACHE_PATH, '@ai-sdk', 'google');
    const { createGoogleGenerativeAI } = await import(googlePkgPath);
    const provider = createGoogleGenerativeAI({
      apiKey: 'test-fake-key',
      name: 'google',
    });
    debug('  - Provider created with fake key:', typeof provider);

    const model = provider.languageModel('gemini-3-pro-preview');
    debug('  - Model created:', typeof model);
    debug('  - Model id:', model.modelId);
  } catch (e) {
    console.error('Error creating provider with fake key:', e.message);
    console.error('Stack:', e.stack);
  }

  // Step 5: Simulate the exact code path from provider.ts
  debug('Step 5: Simulating provider.ts code path...');
  try {
    const googlePkgPath = path.join(CACHE_PATH, '@ai-sdk', 'google');
    const mod = await import(googlePkgPath);
    debug('  - Module loaded');
    debug('  - Module keys:', Object.keys(mod));

    // Find the create function (like in provider.ts line 737)
    const createFnKey = Object.keys(mod).find((key) =>
      key.startsWith('create')
    );
    debug('  - Found create function key:', createFnKey);

    if (createFnKey) {
      const fn = mod[createFnKey];
      debug('  - Create function type:', typeof fn);

      // Call it like provider.ts does
      const options = {
        name: 'google',
        // apiKey might be undefined if not in env
      };
      debug(
        '  - Calling create function with options:',
        JSON.stringify(options)
      );

      const loaded = fn(options);
      debug('  - Loaded provider:', typeof loaded);
      debug('  - Loaded provider keys:', Object.keys(loaded));
    }
  } catch (e) {
    console.error('Error in simulated provider.ts path:', e.message);
    console.error('Stack:', e.stack);
  }
}

testGoogleProvider().catch(console.error);
