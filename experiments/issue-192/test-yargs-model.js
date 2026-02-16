#!/usr/bin/env bun
/**
 * Test script to reproduce yargs model argument parsing issue
 * Issue: https://github.com/link-assistant/agent/issues/192
 *
 * Expected: When running `echo "hi" | bun test-yargs-model.js --model kilo/glm-5-free`
 * The argv.model should be "kilo/glm-5-free"
 *
 * Bug: argv.model is "opencode/kimi-k2.5-free" (the default value)
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

console.log('=== Test: Yargs Model Argument Parsing ===');
console.log();
console.log('process.argv:', process.argv);
console.log('hideBin(process.argv):', hideBin(process.argv));
console.log();

const yargsInstance = yargs(hideBin(process.argv))
  .scriptName('test-yargs')
  .command({
    command: '$0',
    describe: 'Test command',
    builder: (yargs) =>
      yargs.option('model', {
        type: 'string',
        description: 'Model to use in format providerID/modelID',
        default: 'opencode/kimi-k2.5-free',
      }),
    handler: async (argv) => {
      console.log('=== Handler Results ===');
      console.log('argv.model:', argv.model);
      console.log();

      if (argv.model === 'opencode/kimi-k2.5-free') {
        console.log('WARNING: argv.model equals the default value!');
        console.log('This might indicate the CLI argument was not parsed correctly.');
      } else {
        console.log('OK: argv.model is different from the default.');
      }

      // Check if the model was explicitly provided
      const args = hideBin(process.argv);
      const modelArgIndex = args.findIndex(arg => arg === '--model' || arg.startsWith('--model='));

      if (modelArgIndex !== -1) {
        console.log();
        console.log('Model argument found in process.argv at index:', modelArgIndex);
        if (args[modelArgIndex] === '--model') {
          console.log('Model value from argv:', args[modelArgIndex + 1]);
        } else {
          console.log('Model value from argv:', args[modelArgIndex].split('=')[1]);
        }
      } else {
        console.log('Model argument NOT found in process.argv');
      }
    },
  })
  .help();

await yargsInstance.argv;
