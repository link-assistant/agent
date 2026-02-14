#!/usr/bin/env bun
/**
 * Test script to reproduce issue 171
 * Tests if yargs correctly parses --model when stdin is piped
 *
 * Run with: cat prompt.txt | bun test-reproduce.js --model kilo/glm-5-free --verbose
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

console.log('=== REPRODUCE ISSUE 171 ===');
console.log('process.argv:', process.argv);
console.log('hideBin:', hideBin(process.argv));

const yargsInstance = yargs(hideBin(process.argv))
  .scriptName('agent')
  .usage('$0 [command] [options]')
  .command({
    command: '$0',
    describe: 'Run agent in interactive or stdin mode (default)',
    builder: (yargs) =>
      yargs
        .option('model', {
          type: 'string',
          description: 'Model to use in format providerID/modelID',
          default: 'opencode/kimi-k2.5-free',
        })
        .option('verbose', {
          type: 'boolean',
          description: 'Enable verbose mode',
          default: false,
        }),
    handler: async (argv) => {
      console.log();
      console.log('=== IN HANDLER ===');
      console.log('argv.model:', argv.model);
      console.log('argv.verbose:', argv.verbose);

      // Simulate parseModelConfig
      const modelArg = argv.model;
      console.log();
      console.log('parseModelConfig simulation:');
      console.log('  modelArg:', modelArg);

      if (modelArg.includes('/')) {
        const modelParts = modelArg.split('/');
        let providerID = modelParts[0];
        let modelID = modelParts.slice(1).join('/');

        console.log('  providerID:', providerID);
        console.log('  modelID:', modelID);

        if (!providerID || !modelID) {
          providerID = providerID || 'opencode';
          modelID = modelID || 'kimi-k2.5-free';
          console.log('  FALLBACK TRIGGERED');
        }

        console.log();
        console.log('RESULT:');
        console.log('  using explicit provider/model');
        console.log('  providerID:', providerID);
        console.log('  modelID:', modelID);

        if (providerID !== 'kilo' || modelID !== 'glm-5-free') {
          console.log();
          console.log('*** BUG REPRODUCED! ***');
          console.log('Expected: kilo/glm-5-free');
          console.log('Actual:', providerID + '/' + modelID);
        }
      }
    },
  })
  .middleware(async (argv) => {
    // This simulates the middleware from the actual agent
    console.log();
    console.log('=== IN MIDDLEWARE ===');
    console.log('argv.model:', argv.model);
    console.log('argv.verbose:', argv.verbose);
  })
  .help();

// Parse arguments
await yargsInstance.argv;
