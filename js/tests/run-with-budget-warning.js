import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'run-with-budget-warning.sh');
const script = readFileSync(scriptPath, 'utf8');
// The script is bash-only; the Windows matrix leg has no usable process
// groups, so the fixtures below are skipped there rather than reported as
// failures.
const canRunShellFixtures = process.platform !== 'win32';

function runBudget(args, env = {}) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

// Busy-waits until the wall clock is `fraction` of the way through a second,
// so the wrapper's `SECONDS=0` lands just before a second boundary.
function waitForSecondFraction(fraction) {
  const from = fraction * 1000;
  for (;;) {
    const millis = Date.now() % 1000;
    if (millis >= from && millis < from + 30) {
      return;
    }
  }
}

describe('run-with-budget-warning.sh', () => {
  test('passes a successful command through with its output and exit code', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget([
      '30',
      'quick step',
      'bash',
      '-c',
      'echo from-command',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('from-command');
    expect(result.output).toContain('quick step finished in');
  });

  test('preserves the exit code of a failing command', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget(['30', 'failing step', 'bash', '-c', 'exit 3']);

    expect(result.status).toBe(3);
    expect(result.output).not.toContain('::error');
  });

  test('fails with exit code 124 and a titled error when the budget expires', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget(['2', 'slow suite', 'sleep', '60'], {
      BUDGET_GRACE_SECONDS: '2',
    });

    expect(result.status).toBe(124);
    expect(result.output).toContain(
      '::error title=slow suite exceeded its execution budget::'
    );
    expect(result.output).toContain('2s budget');
  });

  test('warns while the overrun can still be acted on', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget(['3', 'warned step', 'sleep', '2'], {
      BUDGET_WARN_PERCENT: '30',
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      '::warning title=warned step is approaching its execution budget::'
    );
  });

  // Issue #337: bash's SECONDS reads 1 as soon as the wall clock crosses a
  // second boundary, so a `-ge` deadline fired up to a second early and a
  // 2s sleep under a 3s budget was killed on a slow macOS runner. Starting
  // 0.75s into a second makes that early kill deterministic: SECONDS hits 2
  // after ~1.25s, before this 1.4s command is done.
  test('never terminates a command that finishes inside its budget (#337)', () => {
    if (!canRunShellFixtures) {
      return;
    }

    waitForSecondFraction(0.75);
    const result = runBudget(['2', 'aligned step', 'sleep', '1.4'], {
      BUDGET_POLL_SECONDS: '0.1',
      BUDGET_GRACE_SECONDS: '1',
    });

    expect(result.output).not.toContain('::error');
    expect(result.status).toBe(0);
  });

  test('kills workers spawned by the command, not just the direct child', () => {
    if (!canRunShellFixtures) {
      return;
    }

    // A unique sleep duration doubles as a marker pgrep can match on.
    const workerSeconds = 900000 + (process.pid % 1000);
    const result = runBudget(
      [
        '2',
        'suite with workers',
        'bash',
        '-c',
        `sleep ${workerSeconds} & sleep ${workerSeconds}`,
      ],
      { BUDGET_GRACE_SECONDS: '1' }
    );

    expect(result.status).toBe(124);

    const survivors = spawnSync('pgrep', ['-f', `^sleep ${workerSeconds}$`], {
      encoding: 'utf8',
    });

    expect(survivors.stdout.trim()).toBe('');
  });

  test('does not let a surviving child hold the wrapper output pipe open', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const workerSeconds = 800000 + (process.pid % 1000);
    try {
      const result = spawnSync(
        'bash',
        [
          scriptPath,
          '30',
          'detached worker',
          'bash',
          '-c',
          `sleep ${workerSeconds} & echo root-finished`,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, BUDGET_POLL_SECONDS: '0.05' },
          timeout: 5000,
        }
      );

      expect(result.signal).toBe(null);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('root-finished');
      expect(result.stdout).toContain('detached worker finished');
    } finally {
      spawnSync('pkill', ['-f', `^sleep ${workerSeconds}$`]);
    }
  });

  test('keeps control state when the wrapped command cleans TMPDIR', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'budget-state-'));
    const commandTmp = join(root, 'command-tmp');
    const runnerTmp = join(root, 'runner-tmp');
    mkdirSync(commandTmp);
    mkdirSync(runnerTmp);

    try {
      const result = runBudget(
        [
          '5',
          'tmp-cleaning command',
          'bash',
          '-c',
          'rm -rf "${TMPDIR:?}"/*; echo command-completed',
        ],
        {
          TMPDIR: commandTmp,
          RUNNER_TEMP: runnerTmp,
          BUDGET_POLL_SECONDS: '0.05',
        }
      );

      expect(result.status).toBe(0);
      expect(result.output).toContain('command-completed');
      expect(result.output).not.toContain('No such file or directory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails clearly when the private state parent is unavailable', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget(['5', 'missing state', 'true'], {
      BUDGET_STATE_PARENT: join(
        tmpdir(),
        `missing-budget-parent-${process.pid}`
      ),
    });

    expect(result.status).toBe(2);
    expect(result.output).toContain(
      'Could not create budget control state under'
    );
  });

  test('traces its decisions only when BUDGET_VERBOSE is enabled', () => {
    if (!canRunShellFixtures) {
      return;
    }

    expect(runBudget(['30', 'quiet step', 'true']).output).not.toContain(
      '[budget]'
    );
    expect(
      runBudget(['30', 'traced step', 'true'], { BUDGET_VERBOSE: '1' }).output
    ).toContain('[budget] control state:');
  });

  test('rejects a missing or non-numeric budget', () => {
    if (!canRunShellFixtures) {
      return;
    }

    expect(runBudget(['30', 'no command']).status).toBe(2);
    expect(runBudget(['ten', 'bad budget', 'true']).status).toBe(2);
    expect(runBudget(['0', 'zero budget', 'true']).status).toBe(2);
  });
});

describe('run-with-budget-warning.sh privileged survivor handling', () => {
  test('uses the process table, passwordless escalation, and explicit reporting', () => {
    expect(script).toContain('ps -eo pgid=,pid=,stat=,user=,args=');
    expect(script).toContain('sudo -n kill');
    expect(script).toContain('left processes running');
    expect(script).toContain('>"${stdout_file}" 2>"${stderr_file}" &');
  });
});

describe('run-with-budget-warning.sh SIGKILL escalation', () => {
  function writeIgnoreTermChild() {
    const root = mkdtempSync(join(tmpdir(), 'budget-child-'));
    const childPath = join(root, 'child-ignore-term.sh');

    // Stays in bash so the trap keeps applying; an exec would drop it.
    writeFileSync(
      childPath,
      [
        '#!/usr/bin/env bash',
        `trap 'echo "child ignored SIGTERM"' TERM`,
        'end=$((SECONDS + 600))',
        'while [ "$SECONDS" -lt "$end" ]; do',
        '  sleep 1 & wait $!',
        'done',
        '',
      ].join('\n')
    );
    chmodSync(childPath, 0o755);

    return childPath;
  }

  test('escalates to SIGKILL when the command ignores SIGTERM', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const childPath = writeIgnoreTermChild();

    try {
      const result = runBudget(['2', 'stubborn step', childPath], {
        BUDGET_GRACE_SECONDS: '2',
      });

      expect(result.status).toBe(124);
      expect(result.output).toContain('child ignored SIGTERM');
      expect(result.output).toContain(
        'stubborn step ignored SIGTERM after 2s; sending SIGKILL.'
      );

      const survivors = spawnSync('pgrep', ['-f', childPath], {
        encoding: 'utf8',
      });

      expect(survivors.stdout.trim()).toBe('');
    } finally {
      rmSync(dirname(childPath), { recursive: true, force: true });
    }
  });

  test('enforces the budget on a fractional poll interval', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget(['2', 'fractional poll', 'sleep', '60'], {
      BUDGET_POLL_SECONDS: '0.5',
      BUDGET_GRACE_SECONDS: '1',
    });

    expect(result.status).toBe(124);
    expect(result.output).not.toContain('invalid arithmetic operator');
  });

  test('rejects a poll interval that is not a number', () => {
    if (!canRunShellFixtures) {
      return;
    }

    const result = runBudget(['30', 'bad poll', 'true'], {
      BUDGET_POLL_SECONDS: 'soon',
    });

    expect(result.status).toBe(2);
    expect(result.output).toContain(
      'BUDGET_POLL_SECONDS must be a positive number, got: soon'
    );
  });
});
