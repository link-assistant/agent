#!/usr/bin/env node
// Git is the inventory: force-added evidence must be scanned even when ignored.
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const cli = fileURLToPath(new URL('../secretlint/node_modules/secretlint/bin/secretlint.js', import.meta.url));
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

export function checkSecrets(root = process.cwd()) {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  if (!files.length) throw new Error('No tracked files; secrets scan did not run');
  const scan = (args, input) => {
    const result = spawnSync(process.execPath, [cli, '--no-gitignore', '--no-glob', ...args], {
      cwd: root, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Secretlint failed (${result.status ?? result.signal})`);
  };
  // Refuse links/submodules/missing paths rather than silently skipping evidence.
  for (const file of files) {
    if (!lstatSync(resolve(root, file)).isFile()) throw new Error(`Not a regular tracked file: ${file}`);
  }
  const plain = files.filter(file => !/\.gz$/i.test(file));
  for (let offset = 0; offset < plain.length; offset += 100) {
    scan(['--', ...plain.slice(offset, offset + 100).map(file => `./${file}`)]);
  }
  for (const file of files.filter(file => /\.gz$/i.test(file))) {
    // Bound both compressed input and inflated output; process one archive at a time.
    if (lstatSync(resolve(root, file)).size > MAX_ARCHIVE_BYTES) throw new Error(`Archive too large: ${file}`);
    let input;
    try {
      input = gunzipSync(readFileSync(resolve(root, file)), { maxOutputLength: MAX_ARCHIVE_BYTES });
    } catch (error) {
      throw new Error(`Cannot scan compressed evidence ${file}: ${error.message}`);
    }
    scan(['--stdinFileName', file.slice(0, -3)], input);
  }
  console.log(`Secrets scan: ${files.length} tracked files checked`);
  return files.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { checkSecrets(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
