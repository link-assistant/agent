import { describe, it, expect } from 'test-anywhere';
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
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/run-with-budget-warning.sh', import.meta.url)
);
const script = readFileSync(scriptPath, 'utf8');

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

describe('run-with-budget-warning.sh', () => {
  itUnless(sandboxed, noPosixShell)(
    'passes a successful command through with its output and exit code',
    () => {
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
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'preserves the exit code of a failing command',
    () => {
      const result = runBudget(['30', 'failing step', 'bash', '-c', 'exit 3']);

      expect(result.status).toBe(3);
      expect(result.output).not.toContain('::error');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails with exit code 124 and a titled error when the budget expires',
    () => {
      const result = runBudget(['2', 'slow suite', 'sleep', '60'], {
        BUDGET_GRACE_SECONDS: '2',
      });

      expect(result.status).toBe(124);
      expect(result.output).toContain(
        '::error title=slow suite exceeded its execution budget::'
      );
      expect(result.output).toContain('2s budget');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'warns while the overrun can still be acted on',
    () => {
      const result = runBudget(['3', 'warned step', 'sleep', '2'], {
        BUDGET_WARN_PERCENT: '30',
      });

      expect(result.status).toBe(0);
      expect(result.output).toContain(
        '::warning title=warned step is approaching its execution budget::'
      );
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'kills workers spawned by the command, not just the direct child',
    () => {
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
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'does not let a surviving child hold the wrapper output pipe open',
    () => {
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
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'keeps control state when the wrapped command cleans TMPDIR',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'budget-state-'));
      const commandTmp = path.join(root, 'command-tmp');
      const runnerTmp = path.join(root, 'runner-tmp');
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
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails clearly when the private state parent is unavailable',
    () => {
      const result = runBudget(['5', 'missing state', 'true'], {
        BUDGET_STATE_PARENT: path.join(
          tmpdir(),
          `missing-budget-parent-${process.pid}`
        ),
      });

      expect(result.status).toBe(2);
      expect(result.output).toContain(
        'Could not create budget control state under'
      );
    }
  );
});

describe('run-with-budget-warning.sh argument validation', () => {
  itUnless(sandboxed, noPosixShell)(
    'rejects a missing or non-numeric budget',
    () => {
      expect(runBudget(['30', 'no command']).status).toBe(2);
      expect(runBudget(['ten', 'bad budget', 'true']).status).toBe(2);
      expect(runBudget(['0', 'zero budget', 'true']).status).toBe(2);
    }
  );
});

describe('run-with-budget-warning.sh privileged survivor handling', () => {
  it('uses the process table, passwordless escalation, and explicit reporting', () => {
    expect(script).toContain('ps -eo pgid=,pid=,stat=,user=,args=');
    expect(script).toContain('sudo -n kill');
    expect(script).toContain('left processes running');
    expect(script).toContain('>"${stdout_file}" 2>"${stderr_file}" &');
  });
});

describe('run-with-budget-warning.sh SIGKILL escalation', () => {
  function writeIgnoreTermChild() {
    const root = mkdtempSync(path.join(tmpdir(), 'budget-child-'));
    const childPath = path.join(root, 'child-ignore-term.sh');

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

  itUnless(sandboxed, noPosixShell)(
    'escalates to SIGKILL when the command ignores SIGTERM',
    () => {
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
        rmSync(path.dirname(childPath), { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'enforces the budget on a fractional poll interval',
    () => {
      const result = runBudget(['2', 'fractional poll', 'sleep', '60'], {
        BUDGET_POLL_SECONDS: '0.5',
        BUDGET_GRACE_SECONDS: '1',
      });

      expect(result.status).toBe(124);
      expect(result.output).not.toContain('invalid arithmetic operator');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'rejects a poll interval that is not a number',
    () => {
      const result = runBudget(['30', 'bad poll', 'true'], {
        BUDGET_POLL_SECONDS: 'soon',
      });

      expect(result.status).toBe(2);
      expect(result.output).toContain(
        'BUDGET_POLL_SECONDS must be a positive number, got: soon'
      );
    }
  );
});

describe('process group survivor records', () => {
  itUnless(sandboxed, noPosixShell)(
    'prints separate real process records with real newlines',
    () => {
      const groupMembers = script.match(
        /^group_members\(\) \{[\s\S]*?^\}/m
      )?.[0];
      const result = spawnSync(
        'bash',
        [
          '-c',
          `
      set -m
      ${groupMembers}
      (sleep 30 & sleep 31 & wait) &
      command_pid=$!
      trap 'kill -KILL -- -"$command_pid" 2>/dev/null; wait "$command_pid" 2>/dev/null' EXIT
      sleep 0.2
      group_members
    `,
        ],
        { encoding: 'utf8' }
      );
      const records = result.stdout.trim().split('\n');
      expect(records.length).toBeGreaterThan(1);
      const children = records.filter((line) => /sleep 3[01]$/.test(line));
      expect(children.length).toBe(2);
      for (const child of children) {
        expect(child).not.toContain('\\n');
      }
    }
  );
});

describe('budget boundary regression', () => {
  itUnless(sandboxed, noPosixShell)(
    'never kills a command that finishes inside its budget at a second boundary',
    () => {
      const align = `
        const { spawnSync } = require('node:child_process');
        const delay = (750 - Date.now() % 1000 + 1000) % 1000;
        setTimeout(() => {
          const result = spawnSync('bash', [process.argv[1], '2', 'aligned', 'sleep', '1.4'], {
            encoding: 'utf8', env: { ...process.env, BUDGET_POLL_SECONDS: '0.05' }
          });
          process.stdout.write(result.stdout + result.stderr);
          process.exit(result.status);
        }, delay);
      `;
      const result = spawnSync('node', ['-e', align, scriptPath], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
    }
  );
});
