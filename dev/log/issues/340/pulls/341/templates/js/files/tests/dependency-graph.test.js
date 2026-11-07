import { describe, expect } from 'test-anywhere';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { itUnless, sandboxed, noPosixShell } from './helpers/skip.js';

const itShell = itUnless(sandboxed, noPosixShell);
function probe(answer, mode = '', recovery = false) {
  const dir = mkdtempSync(join(tmpdir(), 'dependency-graph-'));
  try {
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env bash
printf 'call\\n' >> "$CALLS"
if [[ "$RECOVERY" == 1 && -s "$CALLS" && $(wc -l < "$CALLS") -gt 1 ]]; then exit 0; fi
if [[ "$ANSWER" == enabled ]]; then exit 0; fi
printf '%s\\n' "$ANSWER" >&2
exit 1
`,
      { mode: 0o755 }
    );
    const output = join(dir, 'output');
    const calls = join(dir, 'calls');
    const result = spawnSync(
      'bash',
      [resolve('scripts/check-dependency-graph.sh'), 'base', 'head', mode],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          REPO: 'owner/repo',
          ANSWER: answer,
          RECOVERY: recovery ? '1' : '0',
          CALLS: calls,
          GITHUB_OUTPUT: output,
          DEPENDENCY_GRAPH_ATTEMPTS: '2',
          DEPENDENCY_GRAPH_RETRY_SECONDS: '0',
        },
      }
    );
    return {
      ...result,
      output: readFileSync(output, 'utf8'),
      calls: readFileSync(calls, 'utf8').trim().split('\n').length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe('dependency graph prerequisite', () => {
  itShell(
    'allows enabled graphs and warns on a plain disabled response in PRs',
    () => {
      expect(probe('enabled').output).toContain('state=enabled');
      const result = probe('gh: Forbidden (HTTP 403)');
      expect(result.status).toBe(0);
      expect(result.calls).toBe(1);
      expect(result.output).toContain('enabled=false\nstate=disabled');
      expect(result.stdout).toContain('::warning::');
      expect(result.stdout).toContain(
        'https://github.com/owner/repo/settings/security_analysis'
      );
    }
  );
  itShell('requires the setting outside PRs', () => {
    const result = probe('gh: Forbidden (HTTP 403)', '--require');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::');
  });
  itShell(
    'retries ambiguous answers without diagnosing a disabled graph',
    () => {
      for (const answer of [
        'gh: API rate limit exceeded (HTTP 403)',
        'gh: secondary rate limit (HTTP 403)',
        'gh: Service unavailable (HTTP 503)',
        'network unavailable',
        'gh: Unauthorized (HTTP 401)',
        'gh: Not Found (HTTP 404)',
      ]) {
        const result = probe(answer);
        expect(result.status).toBe(0);
        expect(result.calls).toBe(2);
        expect(result.output).toContain('state=unknown');
        expect(result.stdout).not.toContain('is disabled');
        expect(probe(answer, '--require').status).toBe(1);
      }
      const recovered = probe('gh: Service unavailable (HTTP 503)', '', true);
      expect(recovered.calls).toBe(2);
      expect(recovered.output).toContain('state=enabled');
    }
  );
});
