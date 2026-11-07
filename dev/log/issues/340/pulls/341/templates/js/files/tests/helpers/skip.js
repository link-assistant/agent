/**
 * Register a test as skipped, with the reason in its name, when the runner
 * cannot run it. A test that returns early instead is reported as passed
 * without asserting anything, and one left unregistered vanishes from the
 * summary; either way a runner that covers less looks exactly like one that
 * covers everything. `it.skip` is the only skip all three runtimes report,
 * and none of them prints a reason, hence the name suffix.
 */

import { it } from 'test-anywhere';

const deno = globalThis.Deno;
const platform = typeof process === 'undefined' ? undefined : process.platform;

const DENO_PERMISSIONS = ['read', 'write', 'run', 'env', 'sys', 'net', 'ffi'];

/**
 * @param {typeof globalThis.Deno} [runtime]
 * @returns {string[]} Deno permissions this run was not granted
 */
export function missingDenoPermissions(runtime = deno) {
  if (!runtime) {
    return [];
  }
  return DENO_PERMISSIONS.filter(
    (name) => runtime.permissions.querySync({ name }).state !== 'granted'
  );
}

const missing = missingDenoPermissions();

/**
 * Fixtures write temporary trees, spawn processes and read /proc; Deno
 * allows all of that only under `deno test -A`, which is how CI runs it.
 */
export const sandboxed =
  missing.length > 0
    ? `Deno lacks ${missing.map((name) => `--allow-${name}`).join(' ')}; run deno test -A`
    : null;

/** Bash fixtures need a POSIX shell, which Windows runners lack on PATH. */
export const noPosixShell =
  platform === 'win32' ? 'bash fixtures need a POSIX shell' : null;

/** Windows sync spawn cannot directly execute the gh.cmd fixture. */
export const windowsNodeCmd =
  platform === 'win32' && !process.versions?.bun
    ? 'this runtime cannot spawn the gh.cmd fixture directly on Windows'
    : null;

/** Liveness and /proc fixtures exercise the Linux implementation. */
export const notLinux =
  platform === 'linux' ? null : `Linux-only behaviour, runner is ${platform}`;

/**
 * @param {...(string|null|undefined|false)} reasons first truthy one wins
 * @returns {typeof it} `it`, or a registrar that reports the test as skipped
 */
export function itUnless(...reasons) {
  const reason = reasons.find(Boolean);
  if (!reason) {
    return it;
  }
  return (name, fn) => it.skip(`${name} [skipped: ${reason}]`, fn);
}
