#!/usr/bin/env bun
/**
 * Debug script to check argv.model parsing
 * Issue: https://github.com/link-assistant/agent/issues/171
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

console.log('=== DEBUG ARGV ===');
console.log('process.argv:', process.argv);
console.log('hideBin(process.argv):', hideBin(process.argv));
console.log();

const yargsInstance = yargs(hideBin(process.argv))
  .scriptName('agent')
  .command({
    command: '$0',
    describe: 'Run agent',
    builder: (yargs) =>
      yargs.option('model', {
        type: 'string',
        description: 'Model to use in format providerID/modelID',
        default: 'opencode/kimi-k2.5-free',
      }),
    handler: async (argv) => {
      console.log('In handler:');
      console.log('  argv.model:', argv.model);
      console.log('  typeof argv.model:', typeof argv.model);
      console.log('  full argv:', JSON.stringify(argv, null, 2));

      // Simulate parseModelConfig logic
      const modelArg = argv.model;
      console.log();
      console.log('parseModelConfig simulation:');
      console.log('  modelArg:', modelArg);

      if (modelArg.includes('/')) {
        const modelParts = modelArg.split('/');
        let providerID = modelParts[0];
        let modelID = modelParts.slice(1).join('/');

        console.log('  modelParts:', modelParts);
        console.log('  providerID:', providerID);
        console.log('  modelID:', modelID);

        if (!providerID || !modelID) {
          console.log('  >>> FALLBACK TRIGGERED <<<');
          providerID = providerID || 'opencode';
          modelID = modelID || 'kimi-k2.5-free';
        }

        console.log();
        console.log('Final result:');
        console.log('  providerID:', providerID);
        console.log('  modelID:', modelID);
      } else {
        console.log('  Model does not contain "/" - would use resolution');
      }
    },
  })
  .help();

// Parse arguments
await yargsInstance.argv;
