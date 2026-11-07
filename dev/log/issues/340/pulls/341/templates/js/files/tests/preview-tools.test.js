import { describe, expect, it } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { itUnless, noPosixShell, notLinux, sandboxed } from './helpers/skip.js';

const workflow = parse(
  readFileSync('.github/workflows/example-app.yml', 'utf8')
);
const installer = readFileSync('scripts/setup-preview-gh.sh', 'utf8');

describe('preview container environment', () => {
  it('checks the same container on pull requests before the main writer', () => {
    const tools = workflow.jobs['preview-tools'];
    const writer = workflow.jobs['preview-regen'];
    expect(Boolean(tools)).toBe(true);
    expect(tools.container).toEqual(writer.container);
    expect(tools.if).toBe(undefined);
    expect(tools.permissions ?? workflow.permissions).toEqual({
      contents: 'read',
    });
    expect(writer.needs).toContain('preview-tools');
    expect(workflow.jobs['pipeline-status'].needs).toContain('preview-tools');
    for (const job of [tools, writer]) {
      const commands = job.steps.map((step) => step.run);
      expect(
        commands.indexOf('bash scripts/setup-preview-gh.sh')
      ).toBeGreaterThan(-1);
      expect(
        commands.indexOf('bash scripts/check-preview-tools.sh')
      ).toBeGreaterThan(commands.indexOf('bash scripts/setup-preview-gh.sh'));
    }
    expect(
      tools.steps.some((step) =>
        /git push|push-main|git commit/.test(step.run ?? '')
      )
    ).toBe(false);
  });

  it('verifies the pinned release bytes before extracting or exposing the CLI', () => {
    expect(installer).toContain('set -euo pipefail');
    expect(installer).toMatch(/version=\d+\.\d+\.\d+/);
    expect(installer).toMatch(/checksum=[0-9a-f]{64}\n/);
    expect(installer.indexOf('sha256sum --check')).toBeLessThan(
      installer.indexOf('tar -xzf')
    );
    expect(installer.indexOf('tar -xzf')).toBeLessThan(
      installer.indexOf('>> "$GITHUB_PATH"')
    );
  });

  itUnless(sandboxed, noPosixShell)(
    'reports a missing CLI before attempting credential setup',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'preview-tools-'));
      try {
        for (const tool of ['bash', 'curl', 'git']) {
          const location = spawnSync('bash', ['-c', `command -v ${tool}`], {
            encoding: 'utf8',
          }).stdout.trim();
          symlinkSync(location, join(directory, tool));
        }
        const result = spawnSync('bash', ['scripts/check-preview-tools.sh'], {
          encoding: 'utf8',
          env: { ...process.env, PATH: directory },
          timeout: 5000,
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('missing required tool: gh');
        expect(result.stdout).not.toContain('verified');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  itUnless(
    sandboxed,
    noPosixShell,
    notLinux
  )('stops a bad download before extraction or PATH registration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'preview-download-'));
    try {
      const shim = join(directory, 'download.sh');
      writeFileSync(
        shim,
        `curl() { printf 'invalid archive' > "\${@: -1}"; }\ntar() { echo 'unexpected extraction'; }\nexport -f curl tar\n${installer}`
      );
      const pathFile = join(directory, 'paths');
      writeFileSync(pathFile, '');
      const result = spawnSync('bash', [shim], {
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: directory, GITHUB_PATH: pathFile },
        timeout: 5000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('archive checksum mismatch');
      expect(result.stdout).not.toContain('unexpected extraction');
      expect(readFileSync(pathFile, 'utf8')).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('preview helper-only changes', () => {
  for (const event of ['pull_request', 'push']) {
    it(`runs ${event} checks for all transitive writer helpers`, () => {
      const expected = [
        'setup-preview-gh.sh',
        'check-preview-tools.sh',
        'push-main-with-rebase-retry.mjs',
        'push-failure-classifier.mjs',
        'land-via-pull-request.mjs',
        'run-command.mjs',
        'release-metadata.mjs',
        'github-actions-log.mjs',
        'update-preview-images.mjs',
      ];
      for (const file of expected) {
        expect(workflow.on[event].paths).toContain(`scripts/${file}`);
      }
    });
  }
});
