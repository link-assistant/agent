#!/usr/bin/env bun
/**
 * Reproduce the exact invocation from the broken log to check argv parsing
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { buildRunOptions } from '../js/src/cli/run-options.js';

const yargsInstance = yargs(hideBin(process.argv))
  .scriptName('agent')
  .usage('$0 [command] [options]')
  .version('0.18.3')
  .command({
    command: '$0',
    describe: 'Run agent',
    builder: buildRunOptions,
    handler: async (argv) => {
      console.log('[handler] argv.verbose =', argv.verbose);
    },
  })
  .middleware(async (argv) => {
    console.log('[middleware] argv.verbose =', argv.verbose);
    console.log('[middleware] argv.model =', argv.model);
    console.log('[middleware] all boolean keys:',
      Object.entries(argv)
        .filter(([k,v]) => typeof v === 'boolean')
        .map(([k,v]) => `${k}=${v}`)
        .join(', ')
    );
  });

await yargsInstance.parse();
