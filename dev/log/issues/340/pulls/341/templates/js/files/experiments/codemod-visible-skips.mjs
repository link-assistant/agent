#!/usr/bin/env node
// One-off codemod: turns registration-time gates and early returns in test
// bodies into `itUnless(reason)(...)`, so a test that cannot run is reported
// as skipped, not passed vacuously or dropped from the summary.
// Unknown conditions are left untouched and listed for a manual edit.
// Usage: node experiments/codemod-visible-skips.mjs tests/a.test.js ...
import { readFileSync, writeFileSync } from 'node:fs';

const REASONS = {
  'readOnlyRuntime()': ['sandboxed'],
  "typeof Deno !== 'undefined'": ['sandboxed'],
  "typeof globalThis.Deno !== 'undefined'": ['sandboxed'],
  '!canRunGuardFixtures': ['sandboxed'],
  '!canRunCheckerFixtures': ['sandboxed'],
  '!canSpawn': ['sandboxed'],
  '!canRunShellFixtures': ['sandboxed', 'noPosixShell'],
  '!canRunBash': ['sandboxed', 'noPosixShell'],
  "readOnlyRuntime() || process.platform !== 'linux'": [
    'sandboxed',
    'notLinux',
  ],
  "process.platform !== 'linux' || readOnlyRuntime()": [
    'sandboxed',
    'notLinux',
  ],
  // Wrapped blocks: the condition is the positive capability.
  canRunBashFixtures: ['sandboxed', 'noPosixShell'],
  canRunGitFixtures: ['sandboxed', 'noPosixShell'],
  canRunBash: ['sandboxed', 'noPosixShell'],
};
// Per-file overrides where the same name means something else.
const FILE_REASONS = {
  'tests/check-web-archive.test.js': { '!canRunCliFixtures': ['sandboxed'] },
  'tests/check-changesets.test.js': { canRunCliFixtures: ['sandboxed'] },
  'tests/detect-code-changes.test.js': { canRunCliFixtures: ['sandboxed'] },
  'tests/merge-changesets.test.js': { canRunCliFixtures: ['sandboxed'] },
  'tests/create-github-release.test.js': {
    canRunCliFixtures: ['sandboxed', 'windowsNodeCmd'],
  },
  'tests/no-changelog-comments.test.js': { isDenoRuntime: ['sandboxed'] },
};

const indentOf = (line) => line.length - line.trimStart().length;
const IT = /^(\s*)it\(/;

function blockEnd(lines, start) {
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (
    end < lines.length &&
    !(indentOf(lines[end]) === indent && lines[end].trimStart().startsWith('}'))
  ) {
    end += 1;
  }
  return end;
}

function enclosingOpener(lines, index) {
  const indent = indentOf(lines[index]);
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (lines[previous].trim() !== '' && indentOf(lines[previous]) < indent) {
      return previous;
    }
  }
  return -1;
}

const call = (reasons) => `itUnless(${reasons.join(', ')})(`;

function rewriteEarlyReturn(lines, index, end, reasons) {
  const opener = enclosingOpener(lines, index);
  const openerLine = opener >= 0 ? lines[opener] : '';
  if (/^\s*(?:it|test)\(.*=> \{$/.test(openerLine)) {
    // Early return as a statement of a single-line `it(` header.
    lines[opener] = openerLine.replace(
      /^(\s*)(?:it|test)\(/,
      `$1${call(reasons)}`
    );
  } else if (/\bdescribe\(.*=> \{$/.test(openerLine)) {
    // Early return in a describe callback: every later `it(` at this
    // level is registered as skipped instead.
    const level = indentOf(lines[index]);
    const close = blockEnd(lines, opener);
    for (let next = end + 1; next < close; next += 1) {
      if (indentOf(lines[next]) === level && IT.test(lines[next])) {
        lines[next] = lines[next].replace(IT, `$1${call(reasons)}`);
      }
    }
  } else {
    return false;
  }
  lines.splice(index, end - index + 1);
  return true;
}

function rewriteWrapped(lines, index, end, reasons) {
  const level = indentOf(lines[index]);
  const body = lines.slice(index + 1, end);
  const unwrapped = body.map((line) => {
    const dedented = line.startsWith(' '.repeat(level + 2))
      ? line.slice(2)
      : line;
    return indentOf(line) === level + 2 && IT.test(line)
      ? dedented.replace(IT, `$1${call(reasons)}`)
      : dedented;
  });
  lines.splice(index, end - index + 1, ...unwrapped);
}

function transform(file, source) {
  const lines = source.split('\n');
  const used = new Set();
  const manual = [];
  const table = { ...REASONS, ...FILE_REASONS[file] };

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)if \((.+)\) \{$/);
    if (!match) {
      continue;
    }
    const end = blockEnd(lines, index);
    const body = lines.slice(index + 1, end);
    const reasons = table[match[2]];
    const isReturn =
      body.length === 1 && /^\s*return;(\s*\/\/.*)?$/.test(body[0]);
    const level = indentOf(lines[index]);
    const wraps = body.some(
      (line) =>
        indentOf(line) === level + 2 && /^\s*(?:it|describe)\(/.test(line)
    );
    if (!isReturn && !wraps) {
      continue;
    }
    if (!reasons || (wraps && body.some((line) => /^\s*return;/.test(line)))) {
      manual.push(`${file}:${index + 1} ${match[2]}`);
      continue;
    }
    if (isReturn && !rewriteEarlyReturn(lines, index, end, reasons)) {
      continue;
    }
    if (wraps) {
      rewriteWrapped(lines, index, end, reasons);
    }
    reasons.forEach((reason) => used.add(reason));
    index -= 1;
  }

  let text = lines.join('\n');
  if (used.size > 0 && !text.includes("from './helpers/skip.js'")) {
    const names = ['itUnless', ...[...used].sort()];
    const imports = [...text.matchAll(/^import [\s\S]*?;$/gm)];
    const last = imports.at(-1);
    const at = last.index + last[0].length;
    text = `${text.slice(0, at)}\nimport { ${names.join(', ')} } from './helpers/skip.js';${text.slice(at)}`;
  }
  return { text, manual, used };
}

for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8');
  const { text, manual, used } = transform(file, source);
  if (text !== source) {
    writeFileSync(file, text);
    console.log(`rewrote ${file} (${[...used].join(', ')})`);
  }
  for (const entry of manual) {
    console.log(`MANUAL ${entry}`);
  }
}
