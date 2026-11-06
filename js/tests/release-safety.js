import { describe, expect, test } from 'bun:test';
import {
  assertReleaseMetadata,
  equivalentMetadata,
  setLockPackageVersion,
} from '../../scripts/release-safety.mjs';
import { pushWithRebaseRetry } from '../../scripts/push-with-rebase-retry.mjs';
import { codeChanged } from '../../scripts/detect-ci-changes.mjs';

describe('release safety (#340)', () => {
  test('generated release commits cannot include source files', () => {
    expect(() =>
      assertReleaseMetadata([
        'js/package.json',
        'js/.changeset/fix.md',
        'rust/Cargo.lock',
      ])
    ).not.toThrow();
    expect(() => assertReleaseMetadata(['js/src/index.js'])).toThrow(
      'non-metadata'
    );
    for (const file of [
      'js/.changeset/config.json',
      'js/.changeset/code.js',
      'rust/changelog.d/code.rs',
    ]) {
      expect(() => assertReleaseMetadata([file])).toThrow('non-metadata');
    }
  });
  test('a queued release can accept a version change but cannot accept new dependencies', () => {
    expect(
      equivalentMetadata(
        'js/package.json',
        '{"version":"1","dependencies":{"a":"1"}}',
        '{"version":"2","dependencies":{"a":"1"}}'
      )
    ).toBe(true);
    expect(
      equivalentMetadata(
        'js/package.json',
        '{"version":"1","dependencies":{"a":"1"}}',
        '{"version":"2","dependencies":{"a":"2"}}'
      )
    ).toBe(false);
    const lock =
      '[[package]]\nname = "agent"\nversion = "1.0.0"\n\n[[package]]\nname = "dep"\nversion = "2.0.0"\n';
    const updated = setLockPackageVersion(lock, 'agent', '1.0.1');
    expect(updated).toContain('name = "dep"\nversion = "2.0.0"');
    expect(equivalentMetadata('rust/Cargo.lock', lock, updated, 'agent')).toBe(
      true
    );
    expect(
      equivalentMetadata(
        'rust/Cargo.lock',
        lock,
        updated.replace('2.0.0', '2.1.0'),
        'agent'
      )
    ).toBe(false);
    expect(() => setLockPackageVersion(lock, 'missing', '1.0.0')).toThrow(
      'missing'
    );
  });
  test('a rule, authentication or network refusal is never retried as a lost race', async () => {
    for (const message of [
      'GH013: Repository rule violations found [rejected]',
      'GH006: protected branch [rejected] (fetch first)',
      'Authentication failed',
      'network unavailable',
    ]) {
      let pushes = 0;
      let rebases = 0;
      await expect(
        pushWithRebaseRetry({
          push: () => {
            pushes++;
            return Promise.reject(new Error(message));
          },
          pullRebase: () => {
            rebases++;
            return Promise.resolve();
          },
          log: () => {},
        })
      ).rejects.toThrow(message);
      expect(pushes).toBe(1);
      expect(rebases).toBe(0);
    }
  });
});

describe('relevant change detection', () => {
  test('docs do not build packages, while sources, dependencies and CI scripts do', () => {
    for (const language of ['js', 'rust']) {
      for (const file of [
        'README.md',
        `${language}/README.md`,
        `${language}/docs/guide.md`,
        'dev/log/issues/340/report.json',
      ]) {
        expect(codeChanged([file], language)).toBe(false);
      }
      for (const file of [
        `${language}/src/prompt.md`,
        `${language}/tests/fixture.md`,
        `${language}/src/tool.ts`,
        'scripts/check-pipeline-status.sh',
        `.github/workflows/${language}.yml`,
        '.prettierignore',
      ]) {
        expect(codeChanged([file], language)).toBe(true);
      }
    }
    expect(codeChanged(['rust/src/lib.rs'], 'js')).toBe(false);
    expect(codeChanged(['js/src/index.ts'], 'rust')).toBe(false);
    expect(codeChanged(['js/package-lock.json'], 'js')).toBe(true);
    expect(codeChanged(['rust/Cargo.lock'], 'rust')).toBe(true);
  });
});
