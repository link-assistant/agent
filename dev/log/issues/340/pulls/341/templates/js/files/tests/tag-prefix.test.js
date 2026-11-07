/**
 * Tests for --tag-prefix support in create-github-release.mjs and format-github-release.mjs
 * Tag names are configurable for multi-language repositories.
 */

import { describe, it, expect } from 'test-anywhere';

import { buildReleaseTag } from '../scripts/release-naming.mjs';

describe('tag prefix logic', () => {
  it('defaults to "v" prefix (backward compatible)', () => {
    expect(buildReleaseTag('1.0.0', { jsRoot: '.' })).toBe('v1.0.0');
  });

  it('auto-detects "js_v" prefix for multi-language repos', () => {
    expect(buildReleaseTag('1.0.0', { jsRoot: 'js' })).toBe('js_v1.0.0');
  });

  it('keeps explicit "js-v" prefix overrides for compatibility', () => {
    expect(buildReleaseTag('1.0.0', { jsRoot: 'js', tagPrefix: 'js-v' })).toBe(
      'js-v1.0.0'
    );
  });

  it('supports "rust-v" prefix', () => {
    expect(
      buildReleaseTag('1.7.8', { jsRoot: 'js', tagPrefix: 'rust-v' })
    ).toBe('rust-v1.7.8');
  });

  it('supports empty prefix', () => {
    expect(buildReleaseTag('2.3.4', { jsRoot: '.', tagPrefix: '' })).toBe(
      '2.3.4'
    );
  });

  it('works with pre-release versions', () => {
    expect(buildReleaseTag('1.0.0-alpha.1', { jsRoot: 'js' })).toBe(
      'js_v1.0.0-alpha.1'
    );
  });
});
