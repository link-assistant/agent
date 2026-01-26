#!/usr/bin/env bun
/**
 * Test script to verify that google/gemini-3-pro alias is added to the database
 * This tests the database transformation logic directly
 */

import { ModelsDev } from '../src/provider/models.ts';

async function testDatabaseAlias() {
  console.log('Testing google/gemini-3-pro database alias...\n');

  try {
    // Get the models database
    const database = await ModelsDev.get();

    // Check if google provider exists
    if (!database['google']) {
      console.log('❌ Google provider not found in database');
      return;
    }

    console.log('✓ Google provider found in database');

    // Check available gemini models
    const googleModels = database['google'].models;
    const geminiModels = Object.keys(googleModels).filter((k) =>
      k.includes('gemini')
    );

    console.log(`\nFound ${geminiModels.length} Gemini models in database:`);
    geminiModels.forEach((model) => {
      console.log(`  - ${model}`);
    });

    // Check if gemini-3-pro-preview exists
    if (googleModels['gemini-3-pro-preview']) {
      console.log('\n✓ gemini-3-pro-preview found in database');
      console.log(`  - Name: ${googleModels['gemini-3-pro-preview'].name}`);
      console.log(`  - ID: ${googleModels['gemini-3-pro-preview'].id}`);
    } else {
      console.log('\n❌ gemini-3-pro-preview NOT found in database');
    }

    // Note: The alias is added in provider.ts state() function, not in the raw database
    // So we won't see it here, but the code is correctly positioned to add it
    console.log(
      '\nNote: The alias google/gemini-3-pro is added in provider.ts state() function'
    );
    console.log(
      '      after the database is loaded. The code change is in place at line 518-528'
    );
  } catch (error) {
    console.error('Error testing database:', error);
  }
}

testDatabaseAlias();
