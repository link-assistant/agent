import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import {
  captureVersionTree,
  syncVersionLock,
} from '../scripts/version-lock.mjs';

function withTree(lockfileVersion, test) {
  const root = mkdtempSync(join(tmpdir(), 'lock-validation-'));
  const pkg = {
    name: 'fixture',
    version: '1.2.3',
    scripts: { test: 'node --test' },
  };
  const lock = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion,
    packages: {
      '': { ...pkg },
      'node_modules/peer': { peer: true, version: '2.3.4' },
    },
  };
  const write = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value));
  write('package.json', pkg);
  write('package-lock.json', lock);
  try {
    test({ root, pkg, lock, write });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('strict version-only tree validation', () => {
  for (const version of [2, 3]) {
    it(`updates exactly two metadata fields in lock v${version}`, () => {
      withTree(version, ({ root, pkg, lock, write }) => {
        const before = captureVersionTree(root);
        write('package.json', { ...pkg, version: '1.2.4' });
        syncVersionLock(root, before);
        assert.deepEqual(
          JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')),
          {
            ...lock,
            version: '1.2.4',
            packages: {
              ...lock.packages,
              '': { ...lock.packages[''], version: '1.2.4' },
            },
          }
        );
      });
    });
  }
  for (const mutation of [
    'unsupported',
    'name',
    'root',
    'version',
    'manifest',
    'graph',
  ]) {
    it(`rejects ${mutation} drift`, () => {
      withTree(3, ({ root, pkg, lock, write }) => {
        const before = captureVersionTree(root);
        if (mutation === 'unsupported') {
          lock.lockfileVersion = 1;
        }
        if (mutation === 'name') {
          lock.name = 'other';
        }
        if (mutation === 'root') {
          delete lock.packages[''];
        }
        if (mutation === 'version') {
          lock.version = '0.0.0';
        }
        if (mutation === 'graph') {
          delete lock.packages['node_modules/peer'];
        }
        if (mutation === 'manifest') {
          pkg.scripts.test = 'echo altered';
        }
        write('package.json', pkg);
        write('package-lock.json', lock);
        assert.throws(() =>
          ['graph', 'manifest'].includes(mutation)
            ? syncVersionLock(root, before)
            : captureVersionTree(root)
        );
      });
    });
  }
});
