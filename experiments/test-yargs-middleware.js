#!/usr/bin/env bun
/**
 * Test: does yargs middleware receive parsed option values
 * when options are defined inside a command's builder?
 *
 * Usage:
 *   echo "hi" | bun experiments/test-yargs-middleware.js --verbose
 *   bun experiments/test-yargs-middleware.js --verbose -p "hello"
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const y = yargs(hideBin(process.argv))
  .scriptName('test')
  .command({
    command: '$0',
    describe: 'default command',
    builder: (yargs) => {
      return yargs.option('verbose', {
        type: 'boolean',
        description: 'verbose mode',
        default: false,
      }).option('prompt', {
        alias: 'p',
        type: 'string',
        description: 'prompt',
      });
    },
    handler: async (argv) => {
      console.log('[handler] argv.verbose =', argv.verbose);
      console.log('[handler] argv =', JSON.stringify(argv, null, 2));
    },
  })
  .middleware(async (argv) => {
    console.log('[middleware] argv.verbose =', argv.verbose);
    console.log('[middleware] typeof argv.verbose =', typeof argv.verbose);
    console.log('[middleware] process.argv =', process.argv.join(' '));
  });

await y.parse();
