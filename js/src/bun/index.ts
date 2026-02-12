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

  export async function run(
    cmd: string[],
    options?: Bun.SpawnOptions.OptionsObject<any, any, any>
  ) {
    log.info(() => ({
      message: 'running',
      cmd: [which(), ...cmd],
      ...options,
    }));
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: '1',
      },
    });
    const code = await result.exited;
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
   * Wait for a specified duration
   */
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  export async function install(pkg: string, version = 'latest') {
    const mod = path.join(Global.Path.cache, 'node_modules', pkg);

    // Use a write lock to serialize all package installations
    // This prevents race conditions when multiple packages are installed concurrently
    using _ = await Lock.write(INSTALL_LOCK_KEY);

    const pkgjson = Bun.file(path.join(Global.Path.cache, 'package.json'));
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} };
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2));
      return result;
    });
    if (parsed.dependencies[pkg] === version) return mod;

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

    // Retry logic for cache-related errors
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await BunProc.run(args, {
          cwd: Global.Path.cache,
        });

        log.info(() => ({
          message: 'package installed successfully',
          pkg,
          version,
          attempt,
        }));
        parsed.dependencies[pkg] = version;
        await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2));
        return mod;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const isCacheError = isCacheRelatedError(errorMsg);

        log.warn(() => ({
          message: 'package installation attempt failed',
          pkg,
          version,
          attempt,
          maxRetries: MAX_RETRIES,
          error: errorMsg,
          isCacheError,
        }));

        if (isCacheError && attempt < MAX_RETRIES) {
          log.info(() => ({
            message: 'retrying installation after cache-related error',
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

        // Non-cache error or final attempt - log and throw
        log.error(() => ({
          message: 'package installation failed',
          pkg,
          version,
          error: errorMsg,
          stack: e instanceof Error ? e.stack : undefined,
          possibleCacheCorruption: isCacheError,
          attempts: attempt,
        }));

        // Provide helpful recovery instructions for cache-related errors
        if (isCacheError) {
          log.error(() => ({
            message:
              'Bun package cache may be corrupted. Try clearing the cache with: bun pm cache rm',
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
