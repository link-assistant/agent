// Bounded, offline reproduction using the actual before/after release scripts.
// No release is published: the injected command adapter only saves its payload.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const version = '1.0.1+build.1';
const results = {};
for (const revision of ['7c81a90', 'working']) {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-340-'));
  try {
    const source =
      revision === 'working'
        ? readFileSync(join(root, 'scripts/create-github-release.mjs'), 'utf8')
        : execFileSync(
            'git',
            ['show', `${revision}:scripts/create-github-release.mjs`],
            { cwd: root, encoding: 'utf8' }
          );
    writeFileSync(join(dir, 'create-github-release.mjs'), source);
    writeFileSync(
      join(dir, 'github-release.mjs'),
      readFileSync(join(root, 'scripts/github-release.mjs'))
    );
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      `## ${version}\n\nExpected release notes\n\n## 1.0.0\nOlder notes\n`
    );
    writeFileSync(
      join(dir, 'use-module.mjs'),
      `
import { writeFileSync } from 'node:fs';
export async function useModule(name) {
  if (name === 'lino-arguments') return { makeConfig: () => ({ releaseVersion: '${version}', repository: 'example/probe', prefix: '' }) };
  return { $: () => ({ run: async ({ stdin } = {}) => {
    if (stdin) writeFileSync('release.json', stdin);
    return { stdout: '{}' };
  } }) };
}
`
    );
    execFileSync(process.execPath, ['create-github-release.mjs'], {
      cwd: dir,
      stdio: 'pipe',
    });
    results[revision] = JSON.parse(
      readFileSync(join(dir, 'release.json'), 'utf8')
    ).body;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
assert.equal(results['7c81a90'], `Release ${version}`);
assert.equal(results.working, 'Expected release notes');
console.log(JSON.stringify({ version, ...results }, null, 2));
