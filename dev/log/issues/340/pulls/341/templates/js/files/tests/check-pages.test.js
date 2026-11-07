import { describe, expect, it } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const SCRIPT = 'scripts/check-pages.sh';
// PATH entries are directories, so the stub lives at
// tests/fixtures/pages-stub/gh and the directory goes on PATH.
const STUB_DIR = 'tests/fixtures/pages-stub';
const SETTINGS_URL = 'https://github.com/owner/repo/settings/pages';

const itShell = itUnless(sandboxed, noPosixShell);

function runCheck({ pagesStatus, buildType = 'workflow', mode }) {
  const dir = mkdtempSync(join(tmpdir(), 'pages-'));
  try {
    writeFileSync(join(dir, 'pages_status'), String(pagesStatus));
    writeFileSync(join(dir, 'build_type'), `${buildType}\n`);
    const output = join(dir, 'output');
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${STUB_DIR}:${process.env.PATH}`,
        PAGES_FIXTURE_DIR: dir,
        REPOSITORY: 'owner/repo',
        PAGES_MODE: mode,
        GITHUB_OUTPUT: output,
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      output: existsSync(output) ? readFileSync(output, 'utf8') : '',
      requests: readFileSync(join(dir, 'requests'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-pages.sh', () => {
  itShell('reports a site deployed by GitHub Actions in both modes', () => {
    for (const mode of ['warn', 'require']) {
      const result = runCheck({ pagesStatus: 200, mode });

      expect(result.status).toBe(0);
      expect(result.output).toBe('enabled=true\n');
      expect(result.requests).toContain('api repos/owner/repo/pages');
    }
  });

  itShell('warns and lets pull requests pass while Pages is off', () => {
    const result = runCheck({ pagesStatus: 404, mode: 'warn' });

    expect(result.status).toBe(0);
    expect(result.output).toBe('enabled=false\n');
    expect(result.stdout).toContain(
      '::warning::GitHub Pages is not enabled for owner/repo'
    );
    expect(result.stdout).toContain(SETTINGS_URL);
  });

  itShell('fails the default branch with the setting to change', () => {
    const result = runCheck({ pagesStatus: 404, mode: 'require' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::GitHub Pages is not enabled for owner/repo'
    );
    expect(result.stdout).toContain('A maintainer must act');
    expect(result.stdout).toContain('Source to GitHub Actions');
    expect(result.stdout).toContain(SETTINGS_URL);
  });

  itShell('treats a branch-built site as misconfigured', () => {
    const result = runCheck({
      pagesStatus: 200,
      buildType: 'legacy',
      mode: 'require',
    });

    expect(result.status).toBe(1);
    expect(result.output).toBe('enabled=false\n');
    expect(result.stdout).toContain(
      "builds from 'legacy', not from GitHub Actions"
    );
  });

  itShell('fails closed on any other API error', () => {
    for (const mode of ['warn', 'require']) {
      const result = runCheck({ pagesStatus: 500, mode });

      expect(result.status).toBe(1);
      expect(result.output).toBe('');
      expect(result.stdout).toContain('::error::Could not query GitHub Pages');
    }
  });

  it('runs before configure-pages with an explicit Pages read grant', () => {
    // Windows checkouts can have CRLF line endings.
    const workflow = readFileSync(
      '.github/workflows/example-app.yml',
      'utf8'
    ).replaceAll('\r\n', '\n');
    const job = workflow
      .split('\n  web-build:')[1]
      .split('\n  pages-deploy:')[0];

    expect(job).toMatch(/permissions:\n\s+contents: read\n\s+pages: read/);
    expect(job.indexOf('scripts/check-pages.sh')).toBeGreaterThan(0);
    expect(job.indexOf('scripts/check-pages.sh')).toBeLessThan(
      job.indexOf('actions/configure-pages')
    );
    expect(job).toContain(
      "PAGES_MODE: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'require' || 'warn' }}"
    );
  });
});
