#!/usr/bin/env node
// Husky reports installation errors through returned messages.
// Verify core.hooksPath after installation so prepare cannot silently succeed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { debug } from './debug-print.mjs';

export async function installGitHooks({
  env = process.env,
  exists = existsSync,
  install = async () => (await import('husky')).default(),
  readHooksPath = () =>
    execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  log = console.error,
} = {}) {
  if (env.CI || env.HUSKY === '0') {
    debug('Skipping Git hooks: CI or HUSKY=0');
    return 0;
  }
  if (!exists('../.git') && !exists('.git')) {
    debug('Skipping Git hooks: no Git repository');
    return 0;
  }

  debug('Installing Git hooks through the Husky API');
  const message = (await install()).trim();
  let hooksPath;
  try {
    hooksPath = readHooksPath();
  } catch {
    hooksPath = '';
  }
  if (!hooksPath) {
    log(`git hooks were not installed: ${message || 'husky said nothing'}`);
    return 1;
  }
  debug('Git hooks installed', { hooksPath });
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await installGitHooks();
}
