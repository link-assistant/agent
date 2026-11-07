#!/usr/bin/env node
// Exercise Git's actual checkout filters without touching the caller's index.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'issue-262-crlf-'));
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' });
try {
  git('init', '-q');
  git('config', 'core.autocrlf', 'true');
  const files = execFileSync('git', ['ls-files', '-z', '*.sh', '.husky/*'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  writeFileSync(join(root, '.gitattributes'), readFileSync('.gitattributes'));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(file));
  }
  git('add', '.');
  // checkout-index overwrites from the index through the working-tree filters.
  git('checkout-index', '--all', '--force');
  for (const file of files) {
    assert.ok(!readFileSync(join(root, file), 'utf8').includes('\r'), file);
  }
  console.log(`core.autocrlf=true: ${files.length} scripts/hooks retain LF`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
