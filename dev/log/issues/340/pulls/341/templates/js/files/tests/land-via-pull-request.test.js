import { describe, it, expect } from 'test-anywhere';

import {
  findOpenPullRequest,
  landViaPullRequest,
  mergePullRequestWithRetry,
  pullRequestBranchName,
  waitForPullRequestChecks,
} from '../scripts/land-via-pull-request.mjs';

const silentLogger = { log() {}, error() {} };

/**
 * Record every invocation and answer from a scripted queue of results.
 * @param {Array<{match: RegExp, result: object}>} script
 */
function makeRunner(script) {
  const calls = [];
  const invocations = [];
  const runner = async (command, args, options = {}) => {
    const line = `${command} ${args.join(' ')}`;
    calls.push(line);
    invocations.push({ command, args, options });
    const entry = script.find((candidate) => candidate.match.test(line));
    return entry ? entry.result : { code: 0, stdout: '', stderr: '' };
  };
  runner.calls = calls;
  runner.invocations = invocations;
  return runner;
}

describe('land-via-pull-request', () => {
  it('names the branch per run so no ref is ever force-pushed or deleted', () => {
    // A `no destruction` rule targeting ~ALL blocks force pushes and deletions,
    // so a retried run must never reuse the previous run's branch (link-foundation/js-ai-driven-development-pipeline-template#143).
    expect(
      pullRequestBranchName({ label: '2.13.5', runId: '32589574378' })
    ).toBe('release/2.13.5-32589574378');
    expect(pullRequestBranchName({ label: '2.13.5', runId: '1' })).not.toBe(
      pullRequestBranchName({ label: '2.13.5', runId: '2' })
    );
  });

  it('slugifies labels that are not valid ref components', () => {
    expect(
      pullRequestBranchName({ label: 'preview images!', runId: '7' })
    ).toBe('release/preview-images-7');
  });

  it('retries the merge while GitHub is still computing mergeability', async () => {
    let attempts = 0;
    const runner = async () => {
      attempts += 1;
      return attempts < 3
        ? { code: 1, stdout: '', stderr: 'Pull request is not mergeable' }
        : { code: 0, stdout: '', stderr: '' };
    };

    const result = await mergePullRequestWithRetry({
      runner,
      url: 'https://example.invalid/pr/1',
      delayMs: 0,
      sleepFn: async () => {},
      logger: silentLogger,
    });

    expect(result).toEqual({ merged: true, attempt: 3 });
  });

  it('gives up with the real command error when the merge never succeeds', async () => {
    const runner = async () => ({
      code: 1,
      stdout: '',
      stderr: 'Pull request is not mergeable',
    });

    let thrown;
    try {
      await mergePullRequestWithRetry({
        runner,
        url: 'https://example.invalid/pr/1',
        maxAttempts: 2,
        delayMs: 0,
        sleepFn: async () => {},
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown?.name).toBe('CommandFailedError');
    expect(thrown?.message).toContain('not mergeable');
  });

  it('does not retry a permanent repository-policy merge rejection', async () => {
    let attempts = 0;
    const runner = async () => {
      attempts += 1;
      return {
        code: 1,
        stdout: '',
        stderr: 'the base branch policy prohibits the merge',
      };
    };

    let thrown;
    try {
      await mergePullRequestWithRetry({
        runner,
        url: 'https://example.invalid/pr/1',
        maxAttempts: 10,
        delayMs: 0,
        sleepFn: async () => {},
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }

    expect(attempts).toBe(1);
    expect(thrown?.message).toContain('base branch policy prohibits');
  });

  it('retries only the short race before pull-request checks are discovered', async () => {
    let attempts = 0;
    const runner = async () => {
      attempts += 1;
      return attempts === 1
        ? { code: 1, stdout: '', stderr: 'no checks reported on the branch' }
        : { code: 0, stdout: 'Pipeline Status\tpass', stderr: '' };
    };

    const result = await waitForPullRequestChecks({
      runner,
      url: 'https://example.invalid/pr/1',
      delayMs: 0,
      sleepFn: async () => {},
      logger: silentLogger,
    });

    expect(result).toEqual({ passed: true, attempt: 2 });
  });
});

describe('land-via-pull-request check enforcement', () => {
  it('propagates a failed pull-request check without attempting a merge', async () => {
    const runner = makeRunner([
      { match: /gh pr list/, result: { code: 0, stdout: '\n' } },
      {
        match: /gh pr create/,
        result: { code: 0, stdout: 'https://example.invalid/pr/9\n' },
      },
      {
        match: /gh pr checks/,
        result: { code: 1, stdout: 'Pipeline Status\tfail', stderr: '' },
      },
    ]);

    let thrown;
    try {
      await landViaPullRequest({
        runner,
        label: '1.2.3',
        runId: '77',
        releasePullRequestToken: 'dedicated-token',
        mergeDelayMs: 0,
        checkDelayMs: 0,
        sleepFn: async () => {},
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown?.message).toContain('Pipeline Status');
    expect(runner.calls.some((call) => call.startsWith('gh pr merge'))).toBe(
      false
    );
  });

  it('merges with --merge only, since allowed_merge_methods may exclude squash', async () => {
    const runner = makeRunner([]);
    await mergePullRequestWithRetry({
      runner,
      url: 'https://example.invalid/pr/1',
      logger: silentLogger,
    });
    expect(runner.calls[0]).toBe(
      'gh pr merge https://example.invalid/pr/1 --merge'
    );
  });
});

describe('land-via-pull-request landing workflow', () => {
  it('pushes, opens, merges, and fast-forwards the checkout', async () => {
    const runner = makeRunner([
      { match: /gh pr list/, result: { code: 0, stdout: '\n' } },
      {
        match: /gh pr create/,
        result: { code: 0, stdout: 'https://example.invalid/pr/9\n' },
      },
    ]);

    const result = await landViaPullRequest({
      runner,
      label: '1.2.3',
      runId: '77',
      releasePullRequestToken: 'dedicated-token',
      mergeDelayMs: 0,
      checkDelayMs: 0,
      sleepFn: async () => {},
      logger: silentLogger,
    });

    expect(result.head).toBe('release/1.2.3-77');
    expect(result.url).toBe('https://example.invalid/pr/9');
    expect(runner.calls[0]).toBe(
      'git push origin HEAD:refs/heads/release/1.2.3-77'
    );
    expect(runner.calls[1]).toContain(
      'gh pr list --head release/1.2.3-77 --base main --state open'
    );
    expect(runner.calls[2]).toContain(
      'gh pr create --base main --head release/1.2.3-77 --title 1.2.3 --body'
    );
    expect(runner.calls[3]).toBe(
      'gh pr checks https://example.invalid/pr/9 --required --watch --fail-fast'
    );
    expect(runner.calls[4]).toBe(
      'gh pr merge https://example.invalid/pr/9 --merge'
    );
    // The checkout must end on the merged base branch so the publish steps in
    // the same job see the merged tree.
    expect(runner.calls.slice(5)).toEqual([
      'git fetch origin main',
      'git reset --hard origin/main',
    ]);

    for (const invocation of runner.invocations.filter(
      ({ command }) => command === 'gh'
    )) {
      expect(invocation.options.env.GH_TOKEN).toBe('dedicated-token');
    }
  });
});

describe('built-in release check attestation', () => {
  it('attests the exact metadata-only commit when no dedicated token is configured', async () => {
    const sha = 'a'.repeat(40);
    const parent = 'b'.repeat(40);
    const runner = makeRunner([
      {
        match: /git rev-parse HEAD\^/,
        result: { code: 0, stdout: `${parent}\n` },
      },
      { match: /git rev-parse HEAD/, result: { code: 0, stdout: `${sha}\n` } },
      {
        match: /git diff-tree/,
        result: { code: 0, stdout: 'M\0package.json\0D\0.changeset/fix.md\0' },
      },
      { match: /gh pr list/, result: { code: 0, stdout: '\n' } },
      {
        match: /gh pr create/,
        result: { code: 0, stdout: 'https://github.com/owner/repo/pull/9\n' },
      },
    ]);

    await landViaPullRequest({
      runner,
      label: '1.2.3',
      runId: '77',
      githubToken: 'builtin-token',
      repository: 'owner/repo',
      parentSha: parent,
      runUrl: 'https://github.com/owner/repo/actions/runs/77',
      sleepFn: async () => {},
      logger: silentLogger,
    });

    const calls = runner.calls;
    const checkIndex = calls.findIndex((call) => call.includes('check-runs'));
    const watchIndex = calls.findIndex((call) =>
      call.startsWith('gh pr checks')
    );
    const mergeIndex = calls.findIndex((call) =>
      call.startsWith('gh pr merge')
    );
    expect(checkIndex).toBeGreaterThan(-1);
    expect(watchIndex).toBeGreaterThan(checkIndex);
    expect(mergeIndex).toBeGreaterThan(watchIndex);
    expect(calls[checkIndex]).toContain(`head_sha=${sha}`);
    expect(calls[watchIndex]).toContain('--required');
    for (const invocation of runner.invocations.filter(
      ({ command }) => command === 'gh'
    )) {
      expect(invocation.options.env.GH_TOKEN).toBe('builtin-token');
    }
  });

  it('rejects source changes before publishing a validation check or merging', async () => {
    const runner = makeRunner([
      {
        match: /git rev-parse HEAD\^/,
        result: { code: 0, stdout: `${'b'.repeat(40)}\n` },
      },
      {
        match: /git rev-parse HEAD/,
        result: { code: 0, stdout: `${'a'.repeat(40)}\n` },
      },
      {
        match: /git diff-tree/,
        result: { code: 0, stdout: 'M\0src/index.js\0' },
      },
    ]);
    let thrown;
    try {
      await landViaPullRequest({
        runner,
        githubToken: 'builtin-token',
        repository: 'owner/repo',
        parentSha: 'b'.repeat(40),
        runUrl: 'https://github.com/owner/repo/actions/runs/77',
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.message).toContain('src/index.js');
    expect(runner.calls.some((call) => call.startsWith('git push'))).toBe(
      false
    );
    expect(runner.calls.some((call) => call.startsWith('gh pr merge'))).toBe(
      false
    );
  });
});

describe('release landing failures and reuse', () => {
  it('stops before merge when the Checks API rejects attestation', async () => {
    const runner = makeRunner([
      {
        match: /git rev-parse HEAD\^/,
        result: { code: 0, stdout: `${'b'.repeat(40)}\n` },
      },
      {
        match: /git rev-parse HEAD/,
        result: { code: 0, stdout: `${'a'.repeat(40)}\n` },
      },
      {
        match: /git diff-tree/,
        result: { code: 0, stdout: 'M\0package.json\0' },
      },
      { match: /gh pr list/, result: { code: 0, stdout: '\n' } },
      {
        match: /gh pr create/,
        result: { code: 0, stdout: 'https://github.com/owner/repo/pull/9\n' },
      },
      {
        match: /check-runs/,
        result: { code: 1, stderr: 'Resource not accessible by integration' },
      },
    ]);
    let thrown;
    try {
      await landViaPullRequest({
        runner,
        githubToken: 'builtin-token',
        repository: 'owner/repo',
        parentSha: 'b'.repeat(40),
        runUrl: 'https://github.com/owner/repo/actions/runs/77',
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.message).toContain('Resource not accessible');
    expect(runner.calls.some((call) => call.startsWith('gh pr checks'))).toBe(
      false
    );
    expect(runner.calls.some((call) => call.startsWith('gh pr merge'))).toBe(
      false
    );
  });

  it('fails closed before pushing a branch when neither token is available', async () => {
    const runner = makeRunner([]);

    let thrown;
    try {
      await landViaPullRequest({
        runner,
        label: '1.2.3',
        runId: '77',
        releasePullRequestToken: '',
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown?.message).toContain('RELEASE_PR_TOKEN');
    expect(runner.calls).toEqual([]);
  });

  it('reuses an open pull request so a re-run creates no duplicate', async () => {
    const runner = makeRunner([
      {
        match: /gh pr list/,
        result: { code: 0, stdout: 'https://example.invalid/pr/9\n' },
      },
    ]);

    await landViaPullRequest({
      runner,
      label: '1.2.3',
      runId: '77',
      releasePullRequestToken: 'dedicated-token',
      mergeDelayMs: 0,
      checkDelayMs: 0,
      sleepFn: async () => {},
      logger: silentLogger,
    });

    expect(runner.calls.some((call) => call.startsWith('gh pr create'))).toBe(
      false
    );
  });

  it('reports no open pull request when the lookup itself fails', async () => {
    const runner = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    expect(
      await findOpenPullRequest({
        runner,
        head: 'release/1.2.3-77',
        base: 'main',
        logger: silentLogger,
      })
    ).toBe('');
  });
});
