#!/usr/bin/env node

/**
 * Lockfile-installed release dependencies with namespace normalization.
 * Literal imports use npm's local dependency tree; loading never installs
 * packages or executes a downloaded loader. Install with npm ci first.
 * CI_SCRIPTS_DEBUG=1 traces module shapes (off by default).
 */
import { debug } from './debug-print.mjs';

function candidates(loaded) {
  return [
    loaded,
    loaded?.default,
    loaded?.['module.exports'],
    loaded?.default?.default,
  ];
}

/**
 * Human-readable description of a loaded module, used in error messages.
 * @param {unknown} loaded
 * @returns {string}
 */
export function describeModule(loaded) {
  if (loaded === null || loaded === undefined) {
    return String(loaded);
  }
  if (typeof loaded !== 'object' && typeof loaded !== 'function') {
    return typeof loaded;
  }
  return `${typeof loaded} with keys [${Object.keys(loaded).join(', ')}]`;
}

/**
 * Pick the object that actually carries `exportName` out of the namespace the loader
 * returned for `moduleName`.
 *
 * @param {unknown} loaded value returned by `await import(moduleName)`
 * @param {string} exportName named export the caller needs
 * @param {string} moduleName package name, used for the error message only
 * @returns {Record<string, unknown>} object exposing `exportName`
 */
export function resolveNamedExport(loaded, exportName, moduleName) {
  for (const candidate of candidates(loaded)) {
    if (candidate && typeof candidate[exportName] === 'function') {
      debug(`resolved ${moduleName}.${exportName}`, {
        received: describeModule(loaded),
        via: candidate === loaded ? 'namespace' : 'unwrapped',
      });
      return candidate;
    }
  }
  throw new Error(
    `Installed ${moduleName} did not expose a callable "${exportName}". ` +
      `Received ${describeModule(loaded)}. Check the installed dependency version (see scripts/use-module.mjs).`
  );
}

/** Only reviewed, lockfile-installed packages can be loaded by this shim. */
export function loadInstalledModule(name) {
  switch (name) {
    case 'command-stream':
      return import('command-stream');
    case 'lino-arguments':
      return import('lino-arguments');
    default:
      throw new Error(`Unsupported release dependency: ${name}`);
  }
}

/** Preserve normalization and the injectable loader used by unit tests. */
export async function useModule(
  moduleName,
  exportName,
  load = loadInstalledModule
) {
  return resolveNamedExport(await load(moduleName), exportName, moduleName);
}

/**
 * Load `command-stream` with `$` guaranteed to be callable and with
 * non-zero exits rejecting.
 *
 * The errexit switch is the semantics every release script is written
 * against: without it `$` RESOLVES on a non-zero exit, so every
 * `try { await $`...`; } catch` in the release path is unreachable and a
 * crashed step prints the success line. The scripts that deliberately
 * probe for a non-zero outcome (`push-main-with-rebase-retry.mjs`,
 * `land-via-pull-request.mjs`) use `runCommand`/`runStrict` from
 * run-command.mjs, which resolves with the code, so this switch does not
 * reach them.
 *
 * @param {(name: string) => Promise<unknown>} [use] injected module loader
 * @returns {Promise<Record<string, unknown>>} command-stream exports
 */
export async function loadCommandStream(use) {
  const commandStream = await useModule('command-stream', '$', use);
  const shell = commandStream.shell;

  if (shell && typeof shell.errexit === 'function') {
    shell.errexit(true);
  } else {
    debug(
      'command-stream did not expose shell.errexit; $ keeps resolve-on-exit semantics'
    );
  }

  return commandStream;
}

/**
 * Load `lino-arguments` with `makeConfig` guaranteed to be callable.
 *
 * @param {(name: string) => Promise<unknown>} [use] injected module loader
 * @returns {Promise<Record<string, unknown>>} lino-arguments exports
 */
export function loadLinoArguments(use) {
  return useModule('lino-arguments', 'makeConfig', use);
}
