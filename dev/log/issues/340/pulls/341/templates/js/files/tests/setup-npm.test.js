import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import {
  NODE_MIN_VERSION,
  NPM_MIN_VERSION,
  compareVersions,
  isSupportedNodeVersion,
  isSupportedNpmVersion,
  selectLatestSupportedNpmRelease,
} from '../scripts/setup-npm.mjs';

function makeNpmMetadata(versions) {
  return {
    versions: Object.fromEntries(
      versions.map((version) => [
        version,
        {
          dist: {
            tarball: `https://registry.npmjs.org/npm/-/npm-${version}.tgz`,
          },
        },
      ])
    ),
  };
}

describe('setup-npm version requirements', () => {
  it('compares semantic versions numerically', () => {
    expect(compareVersions('11.10.0', '11.9.9')).toBe(1);
    expect(compareVersions('11.5.1', '11.5.1')).toBe(0);
    expect(compareVersions('11.5.0', '11.5.1')).toBe(-1);
  });

  it(`requires npm ${NPM_MIN_VERSION} or later`, () => {
    expect(isSupportedNpmVersion('11.4.2')).toBe(false);
    expect(isSupportedNpmVersion('11.5.0')).toBe(false);
    expect(isSupportedNpmVersion('11.5.1')).toBe(true);
    expect(isSupportedNpmVersion('11.12.1')).toBe(true);
  });

  it(`requires Node.js ${NODE_MIN_VERSION} or later`, () => {
    expect(isSupportedNodeVersion('v22.13.1')).toBe(false);
    expect(isSupportedNodeVersion('v22.14.0')).toBe(true);
    expect(isSupportedNodeVersion('v24.0.0')).toBe(true);
  });

  it('selects the latest npm 11 tarball that satisfies trusted publishing', () => {
    const release = selectLatestSupportedNpmRelease(
      makeNpmMetadata([
        '11.4.2',
        '11.5.0',
        '11.5.1',
        '11.6.0-beta.0',
        '11.10.0',
        '12.0.0',
      ])
    );

    expect(release).toEqual({
      version: '11.10.0',
      tarballUrl: 'https://registry.npmjs.org/npm/-/npm-11.10.0.tgz',
    });
  });
});

describe('setup-npm tarball strategy', () => {
  const script = readFileSync('scripts/setup-npm.mjs', 'utf8');

  it('downloads to a file with retries, then extracts', () => {
    // Piping curl straight into tar meant a truncated transfer (curl exit
    // 18, which plain --retry does not cover) left a half-populated npm
    // directory behind; a file download restarts cleanly on retry.
    expect(script).toContain(
      'curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors'
    );
    expect(script).toContain('-o "${tarball}"');
    expect(script).toContain(
      'tar xz --strip-components=1 -C "${tempNpmDir}" -f "${tarball}"'
    );
    expect(script).not.toContain('| tar xz');
  });

  it('clears the staging directory before extracting', () => {
    const download = script.indexOf('curl -fsSL --retry');
    const clean = script.indexOf('rm -rf "${tempNpmDir}" && mkdir -p');
    const extract = script.indexOf('tar xz --strip-components=1');

    expect(clean).toBeGreaterThan(download);
    expect(extract).toBeGreaterThan(clean);
  });
});
