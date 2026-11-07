import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';

describe('Wayback CLI retries and failure reporting', () => {
  for (const scenario of ['recover', 'persistent']) {
    itUnless(sandboxed)(
      `handles ${scenario} HTTP 429 without claiming no snapshot`,
      () => {
        const root = mkdtempSync(join(tmpdir(), 'wayback-cli-'));
        try {
          const report = join(root, 'report.md');
          const output = join(root, 'output');
          writeFileSync(
            report,
            '# Link Checker Report\n\n| Errors | 1 |\n\n## Errors per input\n\n* [404] https://example.com/\n'
          );
          const result = spawnSync(
            'node',
            [
              '--import',
              pathToFileURL(resolve('tests/fixtures/wayback-fetch.mjs')).href,
              resolve('scripts/check-web-archive.mjs'),
            ],
            {
              encoding: 'utf8',
              env: {
                ...process.env,
                LYCHEE_OUTPUT: report,
                GITHUB_OUTPUT: output,
                RECOVERED_URLS: join(root, 'missing'),
                WAYBACK_FIXTURE: scenario,
              },
            }
          );
          assert.equal(
            result.status,
            scenario === 'recover' ? 0 : 1,
            result.stdout + result.stderr
          );
          assert.match(result.stdout, /Retrying Wayback lookup/);
          assert.doesNotMatch(
            result.stdout,
            /No archived version|No Web Archive fallback/
          );
          assert.equal(
            readFileSync(output, 'utf8').trim(),
            `all_archived=${scenario === 'recover'}`
          );
          if (scenario === 'persistent') {
            assert.match(
              result.stdout,
              /Web Archive lookup failed.*HTTP 429 \(after 3 attempts\)/
            );
            assert.match(result.stdout, /Re-run the job/);
            assert.doesNotMatch(result.stdout, /Fix or remove/);
          } else {
            assert.match(result.stdout, /https:\/\/web\.archive\.org\//);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }
});
