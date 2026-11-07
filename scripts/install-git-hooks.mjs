// Adapted from the JS pipeline template: Husky returns failures as messages.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import path from 'node:path';

const require = createRequire(new URL('../js/package.json', import.meta.url));
export async function installGitHooks({
  env = process.env,
  install = async () =>
    (await import(pathToFileURL(require.resolve('husky')).href)).default(),
  readHooksPath = () =>
    execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  log = console.error,
} = {}) {
  if (env.CI || env.HUSKY === '0') {
    return 0;
  }
  const message = (await install()).trim();
  let hooksPath;
  try {
    hooksPath = readHooksPath();
  } catch {
    hooksPath = '';
  }
  if (message || !hooksPath) {
    log(
      `Git hooks were not installed: ${message || 'Husky returned no details'}`
    );
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (!process.env.CI && process.env.HUSKY !== '0') {
    // prepare runs from js/; install hooks in the actual repository root.
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
    process.chdir(root);
  }
  process.exitCode = await installGitHooks();
}
