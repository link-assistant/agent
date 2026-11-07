import { describe, it, expect } from 'test-anywhere';

import {
  buildReleaseTag,
  buildReleaseTitle,
  getDefaultTagPrefix,
  getReleaseTagPrefix,
  isMultiLanguage,
  normalizeReleaseVersion,
} from '../scripts/release-naming.mjs';

const MULTI = { jsRoot: 'js' };
const SINGLE = { jsRoot: '.' };

describe('release naming layout detection', () => {
  it('treats js/package.json layouts as multi-language', () => {
    expect(isMultiLanguage(MULTI)).toBe(true);
  });

  it('treats root package.json layouts as single-language', () => {
    expect(isMultiLanguage(SINGLE)).toBe(false);
  });
});

describe('release naming tag prefixes', () => {
  it('uses js_v for auto-detected multi-language releases', () => {
    expect(getDefaultTagPrefix(MULTI)).toBe('js_v');
  });

  it('uses v for auto-detected single-language releases', () => {
    expect(getDefaultTagPrefix(SINGLE)).toBe('v');
  });

  it('keeps an explicit tag prefix override', () => {
    expect(getReleaseTagPrefix({ ...MULTI, tagPrefix: 'js-v' })).toBe('js-v');
  });
});

describe('release naming tag construction', () => {
  it('builds js_v tags in multi-language mode', () => {
    expect(buildReleaseTag('1.2.3', MULTI)).toBe('js_v1.2.3');
  });

  it('builds plain v tags in single-language mode', () => {
    expect(buildReleaseTag('1.2.3', SINGLE)).toBe('v1.2.3');
  });

  it('does not double-prefix an already namespaced multi-language version', () => {
    expect(buildReleaseTag('js_v1.2.3', MULTI)).toBe('js_v1.2.3');
    expect(buildReleaseTag('js-v1.2.3', MULTI)).toBe('js_v1.2.3');
  });

  it('does not double-prefix an already tagged single-language version', () => {
    expect(buildReleaseTag('v1.2.3', SINGLE)).toBe('v1.2.3');
  });

  it('supports explicit legacy dash prefixes', () => {
    expect(buildReleaseTag('1.2.3', { ...MULTI, tagPrefix: 'js-v' })).toBe(
      'js-v1.2.3'
    );
  });

  it('works with prerelease and build metadata versions', () => {
    expect(buildReleaseTag('1.2.3-beta.1+build.5', MULTI)).toBe(
      'js_v1.2.3-beta.1+build.5'
    );
  });
});

describe('release naming title construction', () => {
  it('prefixes the language in multi-language mode', () => {
    expect(buildReleaseTitle('1.2.3', MULTI)).toBe('[JavaScript] 1.2.3');
  });

  it('uses package name and version in single-language mode', () => {
    expect(
      buildReleaseTitle('1.2.3', {
        ...SINGLE,
        packageName: '@scope/package-name',
      })
    ).toBe('@scope/package-name 1.2.3');
  });

  it('normalizes prefixed versions before building multi-language titles', () => {
    expect(buildReleaseTitle('js_v1.2.3', MULTI)).toBe('[JavaScript] 1.2.3');
  });

  it('normalizes prefixed versions before building single-language titles', () => {
    expect(
      buildReleaseTitle('v1.2.3', {
        ...SINGLE,
        packageName: 'package-name',
      })
    ).toBe('package-name 1.2.3');
  });

  it('falls back to JavaScript when a single-language package name is unavailable', () => {
    expect(buildReleaseTitle('1.2.3', SINGLE)).toBe('JavaScript 1.2.3');
  });
});

describe('release naming version normalization', () => {
  const cases = [
    ['1.2.3', '1.2.3'],
    ['v1.2.3', '1.2.3'],
    ['V1.2.3', '1.2.3'],
    ['js_v1.2.3', '1.2.3'],
    ['js-v1.2.3', '1.2.3'],
    ['rust_v0.3.4', '0.3.4'],
    ['rust-v0.3.4', '0.3.4'],
    ['csharp_v2.0.0', '2.0.0'],
    ['js_v1.2.3-beta.1', '1.2.3-beta.1'],
    ['js_v1.2.3+build.5', '1.2.3+build.5'],
    ['', ''],
  ];

  for (const [input, expected] of cases) {
    it(`normalizes ${JSON.stringify(input)} to ${JSON.stringify(
      expected
    )}`, () => {
      expect(normalizeReleaseVersion(input)).toBe(expected);
    });
  }
});
