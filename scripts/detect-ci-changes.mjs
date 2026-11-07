#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrComparison, getPrChanges } from './pr-comparison.mjs';

export function codeChanged(files, language) {
  if (!['js', 'rust'].includes(language)) {
    throw new Error('Expected js or rust');
  }
  return files.some((file) => {
    if (file.startsWith('scripts/') || file.startsWith('.husky/')) {
      return true;
    }
    if (
      [
        '.prettierrc',
        '.prettierignore',
        '.secretlintrc.json',
        `.github/workflows/${language}.yml`,
        '.github/workflows/security.yml',
        '.github/workflows/workflows.yml',
      ].includes(file)
    ) {
      return true;
    }
    if (!file.startsWith(`${language}/`)) {
      return false;
    }
    // Markdown under source/tests can be runtime prompts or fixtures.
    if (
      file.startsWith(`${language}/src/`) ||
      file.startsWith(`${language}/tests/`)
    ) {
      return true;
    }
    // A release-only PR still qualifies the package before publishing.
    if (
      file.startsWith(`${language}/.changeset/`) ||
      file.startsWith(`${language}/changelog.d/`)
    ) {
      return !file.endsWith('README.md');
    }
    return !file.endsWith('.md') && !file.startsWith(`${language}/docs/`);
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  let changed = true;
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    const before =
      process.env.GITHUB_EVENT_NAME === 'push'
        ? process.env.GITHUB_BEFORE_SHA
        : undefined;
    const files =
      before && /^0+$/.test(before)
        ? execFileSync('git', ['ls-files'], { encoding: 'utf8' })
            .trim()
            .split('\n')
        : getPrChanges(
            getPrComparison({
              ...process.env,
              ...(before ? { BASE_SHA: before } : {}),
            })
          ).flatMap(({ path, oldPath }) =>
            oldPath ? [path, oldPath] : [path]
          );
    changed = codeChanged(files, process.argv[2]);
    if (process.env.DEBUG) {
      console.log('CI change detection:', files);
    }
  }
  console.log(`code-changed=${changed}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `code-changed=${changed}\n`);
  }
}
