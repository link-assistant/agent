import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { pushWithRecovery } from '../scripts/push-main-with-rebase-retry.mjs';
import { isTransientPushFailure } from '../scripts/push-failure-classifier.mjs';

const logger = { log() {} };
const failed = (stderr) => ({ code: 1, stdout: '', stderr });
const internal = failed(
  'remote: fatal error in commit_refs_rules\n! [remote rejected] HEAD -> main'
);

describe('release push recovery', () => {
  it('retries the reported server error without rebasing or making a PR', async () => {
    const commands = [];
    const sleeps = [];
    const result = await pushWithRecovery({
      runner: async (command, args) => {
        commands.push([command, ...args]);
        return commands.length === 1 ? internal : { code: 0 };
      },
      sleepFn: async (ms) => sleeps.push(ms),
      logger,
    });
    assert.equal(result.pushed, true);
    assert.deepEqual(
      commands,
      Array(2).fill(['git', 'push', 'origin', 'HEAD:main'])
    );
    assert.deepEqual(sleeps, [1000]);
  });

  it('reattests metadata before every unchanged transient retry', async () => {
    const calls = [];
    const parent = 'a'.repeat(40);
    let attempts = 0;
    await pushWithRecovery({
      releaseParent: parent,
      logger,
      sleepFn: async () => {},
      runner: async (_, args) => {
        calls.push(args[0]);
        if (args[0] === 'rev-parse') {
          return {
            code: 0,
            stdout: args[1] === 'HEAD^' ? parent : 'b'.repeat(40),
          };
        }
        if (args[0] === 'diff-tree') {
          return { code: 0, stdout: 'M\0package.json\0' };
        }
        return ++attempts === 1 ? internal : { code: 0 };
      },
    });
    assert.deepEqual(
      calls,
      Array(2).fill(['rev-parse', 'rev-parse', 'diff-tree', 'push']).flat()
    );
  });

  it('stops after three server failures and retains the actual error', async () => {
    let attempts = 0;
    await assert.rejects(
      pushWithRecovery({
        runner: async () => {
          attempts++;
          return internal;
        },
        sleepFn: async () => {},
        logger,
      }),
      /fatal error in commit_refs_rules/
    );
    assert.equal(attempts, 3);
  });

  it('never classifies authentication failures or repository rules as transient', () => {
    for (const text of [
      'GH013: Repository rule violations',
      'GH006 protected branch',
      'Authentication failed',
      'GH013 fatal error in commit_refs_rules',
    ]) {
      assert.equal(isTransientPushFailure(failed(text)), false);
    }
    assert.equal(
      isTransientPushFailure(failed('The requested URL returned error: 503')),
      true
    );
  });

  it('fails permanent release rules without creating an automated PR', async () => {
    const commands = [];
    const messages = [];
    const parent = 'a'.repeat(40);
    await assert.rejects(
      pushWithRecovery({
        releaseParent: parent,
        runner: async (_command, args) => {
          commands.push(args);
          if (args[0] === 'rev-parse') {
            return {
              code: 0,
              stdout: `${args[1] === 'HEAD^' ? parent : 'b'.repeat(40)}\n`,
            };
          }
          if (args[0] === 'diff-tree') {
            return { code: 0, stdout: 'M\0package.json\0' };
          }
          return failed('GH013: Repository rule violations');
        },
        logger: { log: (message) => messages.push(message) },
      }),
      /Configure the rule/
    );
    assert.equal(commands.filter((args) => args[0] === 'push').length, 1);
    assert.equal(
      messages.some((message) => message.includes('landing the commit')),
      false
    );
    assert.equal(
      commands.some((args) => args[0] === 'pr'),
      false
    );
  });
});

describe('release push attestation boundaries', () => {
  it('refuses to rebase a release onto an unvalidated parent', async () => {
    const commands = [];
    const parent = 'a'.repeat(40);
    await assert.rejects(
      pushWithRecovery({
        releaseParent: parent,
        logger,
        runner: async (_, args) => {
          commands.push(args);
          if (args[0] === 'rev-parse') {
            return {
              code: 0,
              stdout: args[1] === 'HEAD^' ? parent : 'b'.repeat(40),
            };
          }
          if (args[0] === 'diff-tree') {
            return { code: 0, stdout: 'M\0package.json\0' };
          }
          return failed('! [rejected] HEAD -> main (non-fast-forward)');
        },
      }),
      /cannot be rebased/
    );
    assert.equal(
      commands.some((args) => args[0] === 'pull' || args[0] === 'rebase'),
      false
    );
  });
  it('gives authentication precedence over a transient error and fails immediately', async () => {
    let attempts = 0;
    await assert.rejects(
      pushWithRecovery({
        logger,
        runner: async () => {
          attempts++;
          return failed(
            'fatal error in commit_refs_rules\n! [rejected] main\nAuthentication failed'
          );
        },
      }),
      /Authentication failed/
    );
    assert.equal(attempts, 1);
  });
  it('keeps diagnostics default-off and records only classification when enabled', async () => {
    const original = process.env.CI_SCRIPTS_DEBUG;
    try {
      for (const enabled of ['0', '1']) {
        process.env.CI_SCRIPTS_DEBUG = enabled;
        const logs = [];
        await pushWithRecovery({
          runner: async () => ({ code: 0 }),
          logger: { log: (line) => logs.push(line) },
        });
        assert.equal(
          logs.some((line) => line.includes('[push] attempt=1 exit=0')),
          enabled === '1'
        );
      }
    } finally {
      if (original === undefined) {
        delete process.env.CI_SCRIPTS_DEBUG;
      } else {
        process.env.CI_SCRIPTS_DEBUG = original;
      }
    }
  });
});
