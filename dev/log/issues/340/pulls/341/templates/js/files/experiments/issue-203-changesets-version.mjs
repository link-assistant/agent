// Exercise real release versioning with runtime and formatter configuration.
// Reuse the maintained fixture so experiments cannot omit the Deno config.
import { execFileSync } from 'node:child_process';

execFileSync(
  process.execPath,
  ['--test', '--test-timeout=30000', 'tests/changeset-config.test.js'],
  { stdio: 'inherit' }
);
