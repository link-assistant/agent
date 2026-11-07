/**
 * Tests for npm badge URLs, version normalization, and format detection.
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import {
  buildNpmVersionBadge,
  encodeShieldsStaticBadgeSegment,
  normalizeReleaseVersionForBadge,
} from '../scripts/format-release-notes-helpers.mjs';

describe('release badge version normalization', () => {
  it('strips a plain v prefix for backward compatibility', () => {
    expect(normalizeReleaseVersionForBadge('v1.7.12')).toBe('1.7.12');
  });

  it('strips a js-v prefix from multi-language release tags', () => {
    expect(normalizeReleaseVersionForBadge('js-v1.7.12')).toBe('1.7.12');
  });

  it('strips a js_v prefix from auto-detected multi-language release tags', () => {
    expect(normalizeReleaseVersionForBadge('js_v1.7.12')).toBe('1.7.12');
  });

  it('strips a rust-v prefix from multi-language release tags', () => {
    expect(normalizeReleaseVersionForBadge('rust-v0.3.4')).toBe('0.3.4');
  });

  it('strips a rust_v prefix from multi-language release tags', () => {
    expect(normalizeReleaseVersionForBadge('rust_v0.3.4')).toBe('0.3.4');
  });

  it('escapes hyphens in prerelease versions for shields.io static badge paths', () => {
    expect(encodeShieldsStaticBadgeSegment('1.0.0-alpha.1')).toBe(
      '1.0.0--alpha.1'
    );
  });

  it('builds a valid shields.io badge URL for prefixed tags', () => {
    const badge = buildNpmVersionBadge('my-package', 'js_v1.7.12');

    expect(badge.includes('/badge/npm-1.7.12-blue.svg')).toBe(true);
    expect(badge.includes('/badge/npm-js_v1.7.12-blue.svg')).toBe(false);
    expect(badge.includes('/my-package/v/1.7.12')).toBe(true);
  });

  it('builds a valid shields.io badge URL for prefixed prerelease tags', () => {
    const badge = buildNpmVersionBadge('my-package', 'js_v1.0.0-alpha.1');

    expect(badge.includes('/badge/npm-1.0.0--alpha.1-blue.svg')).toBe(true);
    expect(badge.includes('/my-package/v/1.0.0-alpha.1')).toBe(true);
  });
});

// Exercise the production skip predicate, including deceptive URL placements.
describe('generated npm badge detection', () => {
  // Execute each formatter guard without invoking GitHub or its CDN loaders.
  const guards = [
    'scripts/format-release-notes.mjs',
    'docs/case-studies/issue-3/original-format-release-notes.mjs',
  ].map(
    (file) =>
      new Function(
        'currentBody',
        'hasGeneratedNpmBadge',
        `return ${readFileSync(file, 'utf8').match(/if \(([^\n]+)\) \{\s*console\.log\('ℹ️ Release notes already formatted'\)/)[1]};`
      )
  );
  for (const body of [
    '### Patch Changes\n- Fix img.shields.io URL handling',
    '![build](https://img.shields.io/badge/build-passing-green)',
    '![npm](https://img.shields.io.attacker.invalid/badge/npm-1-blue.svg)',
    '![npm](https://img.shields.io@attacker.invalid/badge/npm-1-blue.svg)',
    '![npm](https://attacker.invalid/img.shields.io/badge/npm-1-blue.svg)',
    '![npm](http://img.shields.io/badge/npm-1-blue.svg)',
    '![npm](https://user@img.shields.io/badge/npm-1-blue.svg)',
    'https://img.shields.io/badge/npm-1-blue.svg',
  ]) {
    it(`does not skip ordinary notes: ${body}`, async () => {
      const helpers =
        await import('../scripts/format-release-notes-helpers.mjs');
      for (const shouldSkip of guards) {
        expect(shouldSkip(body, helpers.hasGeneratedNpmBadge)).toBe(false);
      }
      expect(helpers.hasGeneratedNpmBadge(body)).toBe(false);
    });
  }
  it('recognizes the actual generated badge', async () => {
    const helpers = await import('../scripts/format-release-notes-helpers.mjs');
    for (const shouldSkip of guards) {
      expect(
        shouldSkip(
          buildNpmVersionBadge('fixture', '1.2.3'),
          helpers.hasGeneratedNpmBadge
        )
      ).toBe(true);
    }
    expect(
      helpers.hasGeneratedNpmBadge(buildNpmVersionBadge('fixture', '1.2.3'))
    ).toBe(true);
  });
});
