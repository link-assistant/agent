import z from 'zod';
import { Global } from '../global';
import { Log } from '../util/log';
import path from 'path';
import { NamedError } from '../util/error';
import { readableStreamToText } from 'bun';
import { Flag } from '../flag/flag';
import { Lock } from '../util/lock';

export namespace BunProc {
  const log = Log.create({ service: 'bun' });

  // Lock key for serializing package installations to prevent race conditions
  const INSTALL_LOCK_KEY = 'bun-install';

  // Default timeout for subprocess commands (2 minutes)
  // This prevents indefinite hangs from known Bun issues:
  // - HTTP 304 response handling (https://github.com/oven-sh/bun/issues/5831)
  // - Failed dependency fetch (https://github.com/oven-sh/bun/issues/26341)
  // - IPv6 configuration issues
  const DEFAULT_TIMEOUT_MS = 120000;

  // Timeout specifically for package installation (60 seconds)
  // Package installations should complete within this time for typical packages
  const INSTALL_TIMEOUT_MS = 60000;

  export const TimeoutError = NamedError.create(
    'BunTimeoutError',
    z.object({
      cmd: z.array(z.string()),
      timeoutMs: z.number(),
    })
  );

  export async function run(
    cmd: string[],
    options?: Bun.SpawnOptions.OptionsObject<any, any, any> & {
      timeout?: number;
    }
  ) {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;

    log.info(() => ({
      message: 'running',
      cmd: [which(), ...cmd],
      timeout,
      cwd: options?.cwd,
    }));

    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout, // Automatically kills process after timeout
      killSignal: 'SIGTERM', // Graceful termination signal
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: '1',
      },
    });

    const code = await result.exited;

    // Check if process was killed due to timeout
    if (result.signalCode === 'SIGTERM' && code !== 0) {
      log.error(() => ({
        message: 'command timed out',
        cmd: [which(), ...cmd],
        timeout,
        signalCode: result.signalCode,
      }));
      throw new TimeoutError({
        cmd: [which(), ...cmd],
        timeoutMs: timeout,
      });
    }

    const stdout = result.stdout
      ? typeof result.stdout === 'number'
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined;
    const stderr = result.stderr
      ? typeof result.stderr === 'number'
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined;
    log.info(() => ({ message: 'done', code, stdout, stderr }));
    if (code !== 0) {
      const parts = [`Command failed with exit code ${result.exitCode}`];
      if (stderr) parts.push(`stderr: ${stderr}`);
      if (stdout) parts.push(`stdout: ${stdout}`);
      throw new Error(parts.join('\n'));
    }
    return result;
  }

  export function which() {
    return process.execPath;
  }

  export const InstallFailedError = NamedError.create(
    'BunInstallFailedError',
    z.object({
      pkg: z.string(),
      version: z.string(),
      details: z.string().optional(),
    })
  );

  // Maximum number of retry attempts for cache-related errors
  const MAX_RETRIES = 3;
  // Delay between retries in milliseconds
  const RETRY_DELAY_MS = 500;

  /**
   * Check if an error is related to Bun cache issues
   */
  function isCacheRelatedError(errorMsg: string): boolean {
    return (
      errorMsg.includes('failed copying files from cache') ||
      errorMsg.includes('FileNotFound') ||
      errorMsg.includes('ENOENT') ||
      errorMsg.includes('EACCES') ||
      errorMsg.includes('EBUSY')
    );
  }

  /**
   * Check if an error is a timeout error
   */
  function isTimeoutError(error: unknown): boolean {
    return error instanceof TimeoutError;
  }

  /**
   * Wait for a specified duration
   */
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Staleness threshold for 'latest' version packages (24 hours).
   * Packages installed as 'latest' will be refreshed after this period.
   * This ensures users get updated packages with bug fixes and new features.
   * @see https://github.com/link-assistant/agent/issues/177
   */
  const LATEST_VERSION_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  export async function install(pkg: string, version = 'latest') {
    const mod = path.join(Global.Path.cache, 'node_modules', pkg);

    // Use a write lock to serialize all package installations
    // This prevents race conditions when multiple packages are installed concurrently
    using _ = await Lock.write(INSTALL_LOCK_KEY);

    const pkgjson = Bun.file(path.join(Global.Path.cache, 'package.json'));
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {}, _installTime: {} };
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2));
      return result;
    });

    // Initialize _installTime tracking if not present
    if (!parsed._installTime) {
      parsed._installTime = {};
    }

    // Check if package is already installed with the requested version
    const installedVersion = parsed.dependencies[pkg];
    const installTime = parsed._installTime[pkg] as number | undefined;

    if (installedVersion === version) {
      // For 'latest' version, check if installation is stale and needs refresh
      // This ensures users get updated packages with important fixes
      // @see https://github.com/link-assistant/agent/issues/177 (specificationVersion v3 support)
      if (version === 'latest' && installTime) {
        const age = Date.now() - installTime;
        if (age < LATEST_VERSION_STALE_THRESHOLD_MS) {
          return mod;
        }
        log.info(() => ({
          message: 'refreshing stale latest package',
          pkg,
          version,
          ageMs: age,
          threshold: LATEST_VERSION_STALE_THRESHOLD_MS,
        }));
      } else if (version !== 'latest') {
        // For explicit versions, don't reinstall
        return mod;
      }
    }

    // Check for dry-run mode
    if (Flag.OPENCODE_DRY_RUN) {
      log.info(() => ({
        message:
          '[DRY RUN] Would install package (skipping actual installation)',
        pkg,
        version,
        targetPath: mod,
      }));
      // In dry-run mode, pretend the package is installed
      return mod;
    }

    // Build command arguments
    const args = [
      'add',
      '--force',
      '--exact',
      '--cwd',
      Global.Path.cache,
      pkg + '@' + version,
    ];

    // Let Bun handle registry resolution:
    // - If .npmrc files exist, Bun will use them automatically
    // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
    // - No need to pass --registry flag
    log.info(() => ({
      message: "installing package using Bun's default registry resolution",
      pkg,
      version,
    }));

    // Retry logic for cache-related errors and timeout errors
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await BunProc.run(args, {
          cwd: Global.Path.cache,
          timeout: INSTALL_TIMEOUT_MS, // Use specific timeout for package installation
        });

        log.info(() => ({
          message: 'package installed successfully',
          pkg,
          version,
          attempt,
        }));
        parsed.dependencies[pkg] = version;
        // Track installation time for 'latest' version staleness checks
        parsed._installTime[pkg] = Date.now();
        await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2));
        return mod;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const isCacheError = isCacheRelatedError(errorMsg);
        const isTimeout = isTimeoutError(e);

        log.warn(() => ({
          message: 'package installation attempt failed',
          pkg,
          version,
          attempt,
          maxRetries: MAX_RETRIES,
          error: errorMsg,
          isCacheError,
          isTimeout,
        }));

        // Retry on cache-related errors or timeout errors
        if ((isCacheError || isTimeout) && attempt < MAX_RETRIES) {
          log.info(() => ({
            message: isTimeout
              ? 'retrying installation after timeout (possible network issue)'
              : 'retrying installation after cache-related error',
            pkg,
            version,
            attempt,
            nextAttempt: attempt + 1,
            delayMs: RETRY_DELAY_MS,
          }));
          await delay(RETRY_DELAY_MS);
          lastError = e instanceof Error ? e : new Error(errorMsg);
          continue;
        }

        // Non-retriable error or final attempt - log and throw
        log.error(() => ({
          message: 'package installation failed',
          pkg,
          version,
          error: errorMsg,
          stack: e instanceof Error ? e.stack : undefined,
          possibleCacheCorruption: isCacheError,
          timedOut: isTimeout,
          attempts: attempt,
        }));

        // Provide helpful recovery instructions
        if (isCacheError) {
          log.error(() => ({
            message:
              'Bun package cache may be corrupted. Try clearing the cache with: bun pm cache rm',
          }));
        }

        if (isTimeout) {
          log.error(() => ({
            message:
              'Package installation timed out. This may be due to network issues or Bun hanging. ' +
              'Try: 1) Check network connectivity, 2) Run "bun pm cache rm" to clear cache, ' +
              '3) Check for IPv6 issues (try disabling IPv6)',
          }));
        }

        throw new InstallFailedError(
          { pkg, version, details: errorMsg },
          {
            cause: e,
          }
        );
      }
    }

    // This should not be reached, but handle it just in case
    throw new InstallFailedError(
      {
        pkg,
        version,
        details: lastError?.message ?? 'Installation failed after all retries',
      },
      { cause: lastError }
    );
  }
}
