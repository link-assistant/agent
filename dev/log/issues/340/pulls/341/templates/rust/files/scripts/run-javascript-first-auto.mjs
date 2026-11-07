// Rust-only projects pass at the checked revision; native counterparts must pass
// all real prerequisite commands. Never infer parity from source detection.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectJavaScript } from './detect-javascript.mjs';

const sha = process.env.EXPECTED_SHA;
if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw Error('Expected an immutable 40-character SHA');
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head() !== sha) throw Error('Checkout revision mismatch');
const detected = detectJavaScript(process.env.PROJECT_DIRECTORY || '.');
const keys = ['JAVASCRIPT_COMMAND', 'PARITY_COMMAND', 'TRANSLATION_COMMAND'];
// Explicit caller commands also opt in, preserving the original reusable API.
const required = detected.required || keys.some(key => process.env[key]?.trim());
if (required) {
  const packagePath = join(detected.directory, 'package.json');
  const manifest = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')) : {};
  const scripts = ['javascript-first:native', 'javascript-first:parity', 'javascript-first:translation'];
  const env = { ...process.env, EXPECTED_SHA: sha, GITHUB_OUTPUT: '' };
  for (const [index, key] of keys.entries()) {
    if (!env[key]?.trim()) {
      if (!manifest.scripts?.[scripts[index]]?.trim()) throw Error(`Detected JavaScript requires ${key} or package script ${scripts[index]}`);
      env[key] = `npm run --silent ${scripts[index]}`;
    }
  }
  console.log(`Native JavaScript prerequisite required (${detected.sources.length} tracked source files)`);
  const result = spawnSync('bash', [new URL('./run-javascript-first.sh', import.meta.url).pathname], {
    cwd: detected.directory, env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
} else {
  console.log('No tracked production JavaScript counterpart detected; Rust-only project.');
}
if (head() !== sha) throw Error('Revision changed during checks');
execFileSync('git', ['diff', '--exit-code'], { stdio: 'inherit' });
execFileSync('git', ['diff', '--cached', '--exit-code'], { stdio: 'inherit' });
if (execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim()) throw Error('Untracked generated drift');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\njavascript-required=${Boolean(required)}\n`);
