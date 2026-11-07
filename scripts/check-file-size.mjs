#!/usr/bin/env node
// Check repository-owned source, regardless of the caller's working directory.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 1500;
export function sourceLimit(file) {
  if (/^(dev\/log|original-opencode|reference-[^/]+)\//.test(file)) {
    return null;
  }
  if (!/\.(?:[cm]?js|tsx?|rs|sh|py)$/.test(file)) {
    return null;
  }
  return MAX_LINES;
}

export function violations(files, read) {
  return files.flatMap((file) => {
    const limit = sourceLimit(file);
    if (limit === null) {
      return [];
    }
    const lines = read(file).split('\n').length;
    return lines > limit ? [{ file, lines, limit }] : [];
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean);
  const failures = violations(files, (file) =>
    readFileSync(path.join(root, file), 'utf8')
  );
  for (const { file, lines, limit } of failures) {
    console.error(
      `::error file=${file}::${lines} lines exceeds ${limit}; split this module.`
    );
  }
  console.log(
    `Checked ${files.filter((file) => sourceLimit(file) !== null).length} source files (limit ${MAX_LINES}).`
  );
  process.exitCode = failures.length > 0 ? 1 : 0;
}
