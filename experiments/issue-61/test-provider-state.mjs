#!/usr/bin/env bun
/**
 * Debug script to check why google provider isn't loading
 */

// Mock env to simulate API key
process.env.GEMINI_API_KEY = 'test-fake-key';

// Import provider module
import { Provider } from '../../src/provider/provider.ts';

async function main() {
  console.log('Listing all providers...');
  const providers = await Provider.list();
  console.log('\nProviders found:', Object.keys(providers));

  const google = providers['google'];
  if (google) {
    console.log('\nGoogle provider details:');
    console.log('  - Source:', google.source);
    console.log('  - Models:', Object.keys(google.info.models));
    console.log('  - Options:', JSON.stringify(google.options, null, 2));
  } else {
    console.log('\nGoogle provider NOT found!');
  }

  // Try to get the model
  try {
    const model = await Provider.getModel('google', 'gemini-3-pro');
    console.log('\nModel loaded successfully:', model.modelID);
  } catch (e) {
    console.error('\nError loading model:', e.name, '-', e.message);
  }
}

main().catch(console.error);
