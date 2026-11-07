import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import {
  uploadArtifactWithRetry,
  downloadArtifactsWithRetry,
  isTransientArtifactError,
} from '../scripts/artifact-transport.mjs';

const fast = { sleep: async () => {}, log: () => {} };
const network = (code) => Object.assign(new Error(code), { code });
describe('bounded artifact SDK retries', () => {
  for (const code of [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EHOSTUNREACH',
  ]) {
    it(`recovers from ${code} and reconciles a lost finalize response`, async () => {
      let calls = 0;
      let finalized = false;
      let deletes = 0;
      const client = {
        uploadArtifact: async () => {
          calls++;
          if (calls === 1) {
            finalized = true;
            throw network(code);
          }
          assert.equal(finalized, false);
          return { id: 7 };
        },
        deleteArtifact: async (name) => {
          assert.equal(name, 'unique');
          deletes++;
          finalized = false;
        },
      };
      assert.equal(
        (
          await uploadArtifactWithRetry(
            client,
            'unique',
            ['file'],
            '.',
            {},
            fast
          )
        ).id,
        7
      );
      assert.equal(calls, 2);
      assert.equal(deletes, 1);
    });
  }
  it('fails after three transient attempts, including retries of reconciliation', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        uploadArtifactWithRetry(
          {
            uploadArtifact: async () => {
              calls++;
              throw network('ENOTFOUND');
            },
            deleteArtifact: async () => {},
          },
          'unique',
          ['file'],
          '.',
          {},
          fast
        ),
      /ENOTFOUND/
    );
    assert.equal(calls, 3);
    let deletes = 0;
    await assert.rejects(
      () =>
        uploadArtifactWithRetry(
          {
            uploadArtifact: async () => {
              throw network('ECONNRESET');
            },
            deleteArtifact: async () => {
              deletes++;
              throw network('ETIMEDOUT');
            },
          },
          'unique',
          ['file'],
          '.',
          {},
          fast
        ),
      /ETIMEDOUT/
    );
    assert.equal(deletes, 2);
  });
  for (const error of [
    Object.assign(new Error('denied'), { status: 403 }),
    new Error('HTTP 401'),
    new Error('HTTP 409'),
    new Error('Artifact storage quota exceeded'),
    new Error('invalid request'),
  ]) {
    it(`immediately refuses ${error.message}`, async () => {
      let calls = 0;
      await assert.rejects(() =>
        uploadArtifactWithRetry(
          {
            uploadArtifact: async () => {
              calls++;
              throw error;
            },
          },
          'unique',
          ['file'],
          '.',
          {},
          fast
        )
      );
      assert.equal(calls, 1);
    });
  }
});

describe('artifact evidence and downloads', () => {
  it('rejects empty evidence and malformed successful responses', async () => {
    assert.throws(
      () => uploadArtifactWithRetry({}, 'unique', [], '.'),
      /empty/
    );
    await assert.rejects(
      () =>
        uploadArtifactWithRetry(
          { uploadArtifact: async () => ({}) },
          'unique',
          ['file'],
          '.',
          {},
          fast
        ),
      /valid artifact ID/
    );
    assert.equal(
      isTransientArtifactError(
        new Error('wrapped', { cause: network('ENOTFOUND') })
      ),
      true
    );
    assert.equal(isTransientArtifactError({ status: 429 }), true);
    assert.equal(isTransientArtifactError({ status: 503 }), true);
  });
  it('continues when retry reconciliation confirms absence', async () => {
    let calls = 0;
    const result = await uploadArtifactWithRetry(
      {
        uploadArtifact: async () => {
          if (++calls === 1) {
            throw network('ENOTFOUND');
          }
          return { id: 8 };
        },
        deleteArtifact: async () => {
          throw Object.assign(new Error('absent'), {
            name: 'ArtifactNotFoundError',
          });
        },
      },
      'unique',
      ['file'],
      '.',
      {},
      fast
    );
    assert.equal(result.id, 8);
  });
  it('retries downloads by immutable ID and refuses missing required artifacts', async () => {
    let calls = 0;
    const client = {
      listArtifacts: async () => ({
        artifacts: [
          { id: 1, name: 'digest-a' },
          { id: 2, name: 'unrelated' },
        ],
      }),
      downloadArtifact: async (id) => {
        assert.equal(id, 1);
        if (++calls === 1) {
          throw network('ENOTFOUND');
        }
      },
    };
    await downloadArtifactsWithRetry(client, 'digest-*', '.', fast);
    assert.equal(calls, 2);
    await assert.rejects(
      () => downloadArtifactsWithRetry(client, 'missing-*', '.', fast),
      /not found/
    );
  });
  it('passes the recorded upload digest so the SDK verifies downloads', async () => {
    const seen = [];
    const client = {
      listArtifacts: async () => ({
        artifacts: [
          { id: 3, name: 'hashed', digest: 'sha256:abc' },
          { id: 4, name: 'hashed-legacy' },
        ],
      }),
      downloadArtifact: async (id, options) => {
        seen.push([id, options]);
      },
    };
    await downloadArtifactsWithRetry(client, 'hashed*', 'out', fast);
    assert.deepEqual(seen, [
      [3, { path: 'out', expectedHash: 'sha256:abc' }],
      [4, { path: 'out' }],
    ]);
  });
});

describe('artifact transport integration requirement', () => {
  it('keeps symlink discovery and required link reports wired through the action', () => {
    const entry = readFileSync(
      '.github/actions/artifact-transport/index.mjs',
      'utf8'
    );
    assert.match(entry, /followSymbolicLinks: true/);
    assert.match(entry, /omitBrokenSymbolicLinks: true/);
    assert.match(entry, /core\.getInput\('required-file'\)/);
    assert.match(
      readFileSync('.github/actions/artifact-transport/action.yml', 'utf8'),
      /required-file: \$\{\{ inputs\.required-file \}\}/
    );
    assert.match(
      readFileSync('.github/workflows/links.yml', 'utf8'),
      /path: lychee\/\s+required-file: lychee\/out\.md\s+if-no-files-found: error/
    );
  });
  it('retries every maintained upload and Pages packaging without ignoring failure', () => {
    for (const file of [
      'example-app',
      'links',
      'release',
      'javascript-first-example',
    ]) {
      const text = readFileSync(`.github/workflows/${file}.yml`, 'utf8');
      assert.doesNotMatch(text, /uses: actions\/upload-(?:pages-)?artifact@/);
      assert.match(text, /uses: \.\/\.github\/actions\/artifact-transport/);
    }
  });
});
