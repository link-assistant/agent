#!/usr/bin/env bun
/**
 * Test script to verify that google/gemini-3-pro alias works correctly
 * This script tests the provider state to ensure the alias is properly registered
 */

import { Provider } from '../src/provider/provider.ts';

async function testGeminiAlias() {
  console.log('Testing google/gemini-3-pro alias...\n');

  try {
    // Get provider state
    const providers = await Provider.list();

    // Check if google provider exists
    if (!providers['google']) {
      console.log(
        '❌ Google provider not loaded (this is expected without API key)'
      );
      console.log(
        '   The alias code is in place, but we cannot test it without authentication'
      );
      return;
    }

    console.log('✓ Google provider is loaded');

    // Check if gemini-3-pro model exists
    const googleModels = providers['google'].info.models;
    if (googleModels['gemini-3-pro']) {
      console.log('✓ gemini-3-pro model found in google provider');
      console.log(`  - Model name: ${googleModels['gemini-3-pro'].name}`);
      console.log(`  - Model ID: ${googleModels['gemini-3-pro'].id}`);
    } else {
      console.log('❌ gemini-3-pro model NOT found in google provider');
      console.log(
        'Available models:',
        Object.keys(googleModels).filter((k) => k.includes('gemini'))
      );
    }

    // Check if gemini-3-pro-preview exists
    if (googleModels['gemini-3-pro-preview']) {
      console.log('✓ gemini-3-pro-preview model found in google provider');
    }
  } catch (error) {
    console.error('Error testing alias:', error);
  }
}

testGeminiAlias();
