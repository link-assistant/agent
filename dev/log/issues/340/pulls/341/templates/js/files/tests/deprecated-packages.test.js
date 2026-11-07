import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';

/**
 * Every committed lockfile must install without deprecated packages. There
 * is deliberately no allowlist: replace or override a deprecated dependency
 * (see docs/CONTRIBUTING.md).
 * npm records `deprecated` when it writes a lockfile, so a package that is
 * deprecated later shows up after the next lockfile update.
 */
const LOCKFILES = [
  'package-lock.json',
  '.github/actions/artifact-transport/package-lock.json',
  'examples/universal-app/package-lock.json',
];

function deprecatedPackages(lockfile) {
  const { packages } = JSON.parse(readFileSync(lockfile, 'utf8'));
  return Object.entries(packages)
    .filter(([, info]) => info.deprecated)
    .map(
      ([path, info]) =>
        `${path.replace(/^node_modules\//, '')}@${info.version}: ${info.deprecated}`
    )
    .sort();
}

describe('deprecated packages', () => {
  for (const lockfile of LOCKFILES) {
    it(`${lockfile} has no deprecated packages`, () => {
      expect(deprecatedPackages(lockfile)).toEqual([]);
    });
  }

  it('covers every committed npm lockfile', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '--', '*package-lock.json'],
      {
        encoding: 'utf8',
      }
    )
      .split('\n')
      .filter(Boolean);
    expect(tracked.sort()).toEqual([...LOCKFILES].sort());
  });
});
