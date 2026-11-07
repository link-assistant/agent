import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateInstantChangelog } from '../../scripts/instant-changelog.mjs';

test.each(['.', 'js'])(
  'manual release writes only its package changelog (%s)',
  (packageDir) => {
    const root = mkdtempSync(join(tmpdir(), 'instant-changelog-340-'));
    const jsRoot = join(root, packageDir);
    const original = '# Changelog\n\n## 1.0.0\n\n- Previous release\n';
    try {
      mkdirSync(jsRoot, { recursive: true });
      writeFileSync(join(root, 'CHANGELOG.md'), original);
      writeFileSync(join(jsRoot, 'CHANGELOG.md'), original);
      updateInstantChangelog({
        jsRoot,
        newVersion: '1.0.1',
        bumpType: 'patch',
        description: 'Release fix',
      });
      const updated = readFileSync(join(jsRoot, 'CHANGELOG.md'), 'utf8');
      expect(updated).toContain(
        '## 1.0.1\n\n### Patch Changes\n\n- Release fix'
      );
      expect(updated.indexOf('## 1.0.1')).toBeLessThan(
        updated.indexOf('## 1.0.0')
      );
      if (packageDir !== '.') {
        expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(original);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
