/**
 * Run fixture commands so a timeout reports the timeout. Killing only the
 * direct child leaves its descendants (cmd.exe, npx, the formatter) running;
 * on Windows they keep the fixture directory open, and the cleanup then fails
 * with EBUSY, which replaces the real failure in the test report.
 */

import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/**
 * Limit for one fixture command, kept under the 30 s per-test limit of
 * `npm test` and `bun test --timeout 30000` so a hung command fails with
 * its own output. It guards against hangs and does not measure speed: under
 * `deno test --parallel`, a Windows runner took over 10 s to start a single
 * `node -e` and 19 s to run the Changesets fixture's five processes.
 */
export const HANG_GUARD_MS = 25000;

/**
 * Kill a process and every process it started.
 *
 * @param {number} pid a process started by runBounded
 * @param {object} [runtime]
 * @param {string} [runtime.platform]
 * @param {typeof spawnSync} [runtime.run]
 * @param {(pid: number, signal: string) => void} [runtime.kill]
 */
export function killTree(
  pid,
  {
    platform = process.platform,
    run = spawnSync,
    kill = (target, signal) => process.kill(target, signal),
  } = {}
) {
  if (platform === 'win32') {
    run('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  // runBounded starts POSIX children as group leaders.
  try {
    kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

/**
 * Run a command with closed stdin and collect its output. The promise
 * rejects with stdout, stderr and the elapsed time on a non-zero exit, and
 * kills the whole process tree once `timeout` milliseconds pass.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeout: number, closeAfterKillMs?: number } & import('node:child_process').SpawnOptions} options
 *   `closeAfterKillMs` bounds the wait for the pipes to close after the kill
 * @returns {Promise<{ stdout: string, stderr: string, elapsedMs: number }>}
 */
export function runBounded(
  command,
  args,
  { timeout, closeAfterKillMs = 1000, ...options }
) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = { stdout: '', stderr: '' };
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (data) => {
        output[stream] += data;
      });
    }
    let timedOut = false;
    let settled = false;
    let forceClose;
    const finish = (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceClose);
      const result = { ...output, elapsedMs: Date.now() - started };
      if (code === 0 && !timedOut) {
        resolve(result);
        return;
      }
      const reason = timedOut
        ? `timed out after ${timeout} ms; killed its process tree`
        : `exited with code ${code}, signal ${signal}`;
      reject(
        Object.assign(
          new Error(`${command} ${args.join(' ')} ${reason}`),
          result,
          {
            code,
            signal,
            timedOut,
          }
        )
      );
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      // A descendant that escaped the kill can hold the pipes open forever.
      forceClose = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null, 'SIGKILL');
      }, closeAfterKillMs);
    }, timeout);
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceClose);
        reject(error);
      }
    });
    child.on('close', finish);
  });
}

/**
 * Remove a fixture directory without letting a cleanup error replace the
 * failure that ended the test.
 *
 * @param {string} dir
 * @param {unknown} failure the error the test body threw, if any
 * @param {typeof rmSync} [remove]
 */
export function removeFixture(dir, failure, remove = rmSync) {
  try {
    remove(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    if (!failure) {
      throw error;
    }
    console.error(`Fixture cleanup also failed: ${error}`);
  }
}
