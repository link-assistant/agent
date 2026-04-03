#!/usr/bin/env bun
/**
 * Test: yargs middleware execution order with option defaults
 * Does middleware see default values or parsed values?
 * What happens when middleware is defined AFTER the command?
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Track order of execution
const log = [];

const y = yargs(hideBin(process.argv))
  .scriptName('test')
  .command({
    command: '$0',
    describe: 'default command',
    builder: (yargs) => {
      log.push('builder called');
      return yargs.option('verbose', {
        type: 'boolean',
        description: 'verbose mode',
        default: false,
      });
    },
    handler: async (argv) => {
      log.push('handler called');
      console.log('Execution order:', log.join(' -> '));
      console.log('argv.verbose =', argv.verbose);
    },
  })
  .middleware(async (argv) => {
    log.push(`middleware called (verbose=${argv.verbose})`);
  });

await y.parse();
