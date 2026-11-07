import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe } from 'test-anywhere';
import { HANG_GUARD_MS, runBounded } from './helpers/bounded-run.js';
import { itUnless, sandboxed } from './helpers/skip.js';

async function rehearse(script, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-api-'));
  const file = join(dir, 'fixture.json');
  const fixture = {
    release: {
      body: {
        id: 123,
        tag_name: 'v1.2.3',
        body: '### Patch Changes\n\n- abcdef123: First change',
      },
    },
    prs: { body: [[{ title: 'feature', number: 1 }]] },
    ...overrides,
  };
  writeFileSync(file, JSON.stringify(fixture));
  try {
    let result;
    try {
      result = {
        ...(await runBounded('node', [resolve(`scripts/${script}.mjs`)], {
          timeout: HANG_GUARD_MS,
          env: {
            ...process.env,
            RELEASE_FIXTURE: file,
            NODE_OPTIONS: `--import=${pathToFileURL(resolve('experiments/issue-273-release-fixture.mjs')).href}`,
            VERSION: '1.2.3',
            RELEASE_ID: '123',
            REPOSITORY: 'fixture/repo',
            COMMIT_SHA: 'abcdef123',
            JS_ROOT: '.',
            TAG_PREFIX: 'v',
          },
        })),
        code: 0,
      };
    } catch (error) {
      result = error;
    }
    return {
      ...result,
      patch: existsSync(`${file}.patch`)
        ? JSON.parse(readFileSync(`${file}.patch`, 'utf8'))
        : null,
      calls: existsSync(`${file}.calls`)
        ? readFileSync(`${file}.calls`, 'utf8')
        : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('required release API evidence', () => {
  for (const script of ['format-github-release', 'format-release-notes']) {
    for (const status of [401, 403, 404, 429, 500, 'ENOTFOUND']) {
      itUnless(sandboxed)(
        `${script} refuses ${status} without writing`,
        async () => {
          const result = await rehearse(script, {
            release: { code: 1, body: '', error: `HTTP ${status}` },
          });
          assert.notEqual(result.code, 0, result.stdout);
          assert.equal(result.patch, null);
        }
      );
    }
    for (const body of [
      '{',
      null,
      {},
      { id: 123, tag_name: 'v1.2.3', body: 7 },
    ]) {
      itUnless(sandboxed)(
        `${script} rejects malformed release ${JSON.stringify(body)}`,
        async () => {
          const result = await rehearse(script, { release: { body } });
          assert.notEqual(result.code, 0, result.stdout);
          assert.equal(result.patch, null);
        }
      );
    }
  }
  for (const prs of [
    { code: 1, body: '', error: 'HTTP 403' },
    { body: '{' },
    { body: [{}] },
    { body: [[{ title: 'feature' }]] },
    { body: [[{ title: 'feature', number: 1 }], {}] },
  ]) {
    itUnless(sandboxed)(
      `aborts before PATCH for refused or malformed PR pages ${JSON.stringify(prs)}`,
      async () => {
        const result = await rehearse('format-release-notes', { prs });
        assert.notEqual(result.code, 0, result.stdout);
        assert.equal(result.patch, null);
      }
    );
  }
  itUnless(sandboxed)(
    'includes page 31 and all relevant PRs, deduplicating and preserving notes',
    async () => {
      const prs = Array.from({ length: 31 }, (_, i) => ({
        title: 'feature',
        number: i + 1,
      }));
      const result = await rehearse('format-release-notes', {
        prs: {
          body: [
            prs.slice(0, 30),
            [prs[30], prs[0], { title: 'chore: version packages', number: 99 }],
          ],
        },
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.calls, /--paginate/);
      assert.match(result.calls, /--slurp/);
      assert.match(result.patch.body, /#30, #31/);
      assert.ok(!result.patch.body.includes('#99'));
      assert.match(result.patch.body, /abcdef123: First change/);
      const again = await rehearse('format-release-notes', {
        release: { body: { id: 123, body: result.patch.body } },
      });
      assert.equal(again.code, 0, again.stderr);
      assert.equal(again.patch, null);
    }
  );
  itUnless(sandboxed)(
    'accepts a valid empty PR page and succeeds after a refused attempt',
    async () => {
      const failed = await rehearse('format-release-notes', {
        prs: { code: 1, error: 'HTTP 500' },
      });
      assert.notEqual(failed.code, 0);
      assert.equal(failed.patch, null);
      const result = await rehearse('format-release-notes', {
        prs: { body: [[]] },
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.patch.body, /npm version/);
    }
  );
});
