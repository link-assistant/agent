import { describe, expect, test } from 'bun:test';
import {
  createOrFindRelease,
  findReleaseId,
} from '../../scripts/github-release.mjs';

const tag = 'js-v1.0.1';
const release = { id: 123, tag_name: tag, draft: false };
const failed = (error) => () => Promise.reject(error);
const found = (data) => () => Promise.resolve(data);

describe('GitHub release failures (#340)', () => {
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
