/**
 * Tests for deriving package identity from package.json.
 * Release scripts must use the package name from package.json, never the
 * template placeholder.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  formatChangesetHeader,
  formatNpmPackageVersion,
  getChangesetVersionTypeRegex,
  parsePackageInfo,
} from '../scripts/package-info.mjs';

describe('package info helpers', () => {
  it('reads scoped package names and versions from package.json content', () => {
    const packageInfo = parsePackageInfo(
      JSON.stringify({
        name: '@link-assistant/agent-commander',
        version: '1.2.3',
      })
    );

    expect(packageInfo.name).toBe('@link-assistant/agent-commander');
    expect(packageInfo.version).toBe('1.2.3');
  });

  it('formats npm package specifiers from the derived package name', () => {
    const packageInfo = parsePackageInfo(
      '{"name":"@scope/real-package","version":"2.0.0"}'
    );

    expect(formatNpmPackageVersion(packageInfo.name, packageInfo.version)).toBe(
      '@scope/real-package@2.0.0'
    );
  });

  it('formats changeset headers from the derived package name', () => {
    const header = formatChangesetHeader('@scope/real-package', 'patch');

    expect(header).toBe("'@scope/real-package': patch");
  });

  it('matches changesets for the derived package name only', () => {
    const regex = getChangesetVersionTypeRegex('@scope/real-package');

    expect(regex.test("---\n'@scope/real-package': minor\n---")).toBe(true);
    expect(regex.test("---\n'my-package': minor\n---")).toBe(false);
  });

  it('does not match version type prefixes as valid changeset bumps', () => {
    const regex = getChangesetVersionTypeRegex('@scope/real-package');

    expect(regex.test("---\n'@scope/real-package': patches\n---")).toBe(false);
  });

  it('reports missing package names clearly', () => {
    let errorMessage = '';

    try {
      parsePackageInfo('{"version":"1.0.0"}');
    } catch (error) {
      errorMessage = error.message;
    }

    expect(errorMessage.includes('Package name is missing')).toBe(true);
  });
});
