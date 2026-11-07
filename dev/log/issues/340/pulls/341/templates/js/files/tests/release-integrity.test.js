import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { extractReleaseNotes } from '../scripts/create-github-release.mjs';
import {
  buildReleaseDescription,
  hasGeneratedNpmBadge,
} from '../scripts/format-release-notes-helpers.mjs';

describe('release Markdown integrity', () => {
  it('ignores generated badge examples inside code', () => {
    const badge =
      '![npm version](https://img.shields.io/badge/npm-1.2.3-blue.svg)';
    assert.equal(hasGeneratedNpmBadge(`~~~md\n${badge}\n~~~`), false);
    assert.equal(hasGeneratedNpmBadge(`    ${badge}`), false);
    assert.equal(hasGeneratedNpmBadge(badge), true);
  });
  for (const fence of ['```', '~~~~']) {
    it(`preserves ${fence} examples and later prose across CRLF boundaries`, () => {
      const body = `### Patch Changes\r\n\r\n- abcdef123: real change\r\n\r\n${fence}md\r\n## 9.9.9\r\n### Major Changes\r\n- deadbeef: example\r\n${fence}\r\n\r\n    - facefeed: indented example\r\n\r\nRemaining details.`;
      const changelog = `# Changelog\r\n\r\n## 1.2.3\r\n\r\n${body}\r\n\r\n## 1.2.2\r\nold`;
      assert.equal(extractReleaseNotes(changelog, '1.2.3'), body);
      const parsed = buildReleaseDescription(body);
      assert.deepEqual(parsed.commitHashes, ['abcdef123']);
      assert.ok(parsed.description.includes('Remaining details.'));
      assert.ok(parsed.description.includes(`${fence}md\r\n## 9.9.9`));
    });
  }
  it('requires an exact real heading and a nonempty required entry', () => {
    assert.throws(
      () => extractReleaseNotes('```md\n## 1.2.3\nexample\n```', '1.2.3'),
      /missing|not found/i
    );
    assert.throws(
      () => extractReleaseNotes('## 1.2.30\nother', '1.2.3'),
      /missing|not found/i
    );
    assert.throws(
      () => extractReleaseNotes('## 1.2.3\n\n## 1.2.2\nold', '1.2.3'),
      /empty/i
    );
  });
  it('matches fence character and minimum closing length', () => {
    const body =
      '````md\n## 8.8.8\n```\n## 7.7.7\n~~~~\n## 6.6.6\n`````\n\nKept.';
    assert.equal(
      extractReleaseNotes(`## 1.2.3\n\n${body}\n\n## 1.2.2\nold`, '1.2.3'),
      body
    );
    assert.equal(
      buildReleaseDescription(
        '```md\n### Patch Changes\n- deadbeef: example\n```'
      ),
      null
    );
  });
});
