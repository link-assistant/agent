import { describe, expect, test } from 'bun:test';
import {
  createOrFindRelease,
  extractReleaseNotes,
  findReleaseId,
} from '../../scripts/github-release.mjs';

const tag = 'js-v1.0.1';
const release = { id: 123, tag_name: tag, draft: false };
const failed = (error) => () => Promise.reject(error);
const found = (data) => () => Promise.resolve(data);

describe('GitHub release failures (#340)', () => {
  test('release notes match exact versions in JS and Rust headings', () => {
    for (const heading of ['1.0.1+build.1', '[1.0.1+build.1] - 2026-11-07']) {
      const changelog = `# Changes\n## 1.0.10\nWrong release\n## ${heading}\n\n### Fixed\n\n- Correct release\n\n## 1.0.0\nOlder release\n`;
      expect(extractReleaseNotes(changelog, '1.0.1+build.1')).toBe(
        '### Fixed\n\n- Correct release'
      );
      expect(extractReleaseNotes(changelog, '1.0.1')).toBe(null);
      expect(extractReleaseNotes(changelog, '1.0.10')).toBe('Wrong release');
    }
  });

  test('heading comparisons treat metacharacters literally and stop at the next section', () => {
    for (const version of [
      '1.0.1-rc.1',
      '1.0.1+build.1',
      'literal\\.*(version)',
    ]) {
      const changelog = `## ${version}\r\nNotes\r\n## Unreleased\r\nFuture\r\n`;
      expect(extractReleaseNotes(changelog, version)).toBe('Notes');
      expect(extractReleaseNotes(changelog, 'missing')).toBe(null);
    }
    expect(extractReleaseNotes('## 1.0.1\n', '1.0.1')).toBe('');
  });

  test('successful creation does not need a lookup', async () => {
    expect(
      await createOrFindRelease({
        tag,
        create: found({}),
        read: failed(new Error('must not query')),
      })
    ).toBe(true);
  });

  test('reruns can confirm an existing public release with the exact tag', async () => {
    expect(
      await createOrFindRelease({
        tag,
        create: failed(new Error('Command failed with exit code 1')),
        read: found(release),
      })
    ).toBe(false);
  });

  test('validation errors are fatal unless the exact public release exists', async () => {
    const error = new Error('Validation Failed (HTTP 422)');
    for (const read of [
      failed(new Error('Not Found (HTTP 404)')),
      failed(new Error('Bad credentials (HTTP 401)')),
      found({ ...release, tag_name: 'different-tag' }),
      found({ ...release, draft: true }),
      found({ ...release, id: undefined }),
    ]) {
      await expect(
        createOrFindRelease({ tag, create: failed(error), read })
      ).rejects.toBe(error);
    }
  });

  test('formatting skips an explicit missing release but propagates other errors', async () => {
    const missing = Object.assign(
      new Error('Command failed with exit code 1'),
      {
        stderr: 'gh: Not Found (HTTP 404)',
      }
    );
    expect(await findReleaseId(failed(missing))).toBe(null);
    for (const message of [
      'Bad credentials (HTTP 401)',
      'Forbidden (HTTP 403)',
      'network unavailable',
      'Not Found without an HTTP status',
    ]) {
      const error = new Error(message);
      await expect(findReleaseId(failed(error))).rejects.toBe(error);
    }
    expect(await findReleaseId(found(release))).toBe('123');
    await expect(findReleaseId(found({}))).rejects.toThrow('valid release ID');
  });
});
