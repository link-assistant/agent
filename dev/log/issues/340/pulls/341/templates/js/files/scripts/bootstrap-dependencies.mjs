#!/usr/bin/env node

/**
 * Module-scope dependency bootstrap for the pipeline scripts.
 *
 * Release scripts load installed command-stream / lino-arguments helpers at
 * module scope, outside main(). Missing or invalid dependencies must still
 * produce a useful annotation and fallback workflow outputs.
 *
 * `bootstrapDependencies()` runs those loads behind the script's own error
 * handling: on failure it prints a GitHub `::error::` annotation naming the
 * cause, writes the fallback outputs the workflow reads (for example
 * `published=false`), and exits with a non-zero status.
 *
 * Usage:
 *   const [{ $ }, { makeConfig }] = await bootstrapDependencies(
 *     [loadCommandStream, loadLinoArguments],
 *     { outputs: { published: 'false' } }
 *   );
 */

import { appendFileSync } from 'node:fs';

import { readEnvVar } from './debug-print.mjs';

/**
 * Append `key=value` lines to the GitHub Actions output file, when there is
 * one. Never throws: a failed write must not mask the real diagnostic.
 *
 * @param {Record<string, string>} outputs
 * @param {{env?: Record<string, string | undefined>,
 *   append?: (file: string, data: string) => void}} [collaborators]
 * @returns {string[]} the lines written, empty when there is no output file
 */
export function writeOutputs(outputs, collaborators = {}) {
  const { env, append = appendFileSync } = collaborators;
  const outputFile = readEnvVar('GITHUB_OUTPUT', env);
  const entries = Object.entries(outputs ?? {});
  if (!outputFile || entries.length === 0) {
    return [];
  }
  const lines = entries.map(([key, value]) => `${key}=${value}\n`);
  try {
    append(outputFile, lines.join(''));
  } catch {
    return [];
  }
  return lines;
}

/**
 * Load module-scope dependencies, reporting a load failure through the
 * script's own channels: an annotation on stderr, the fallback outputs, and a
 * non-zero exit code.
 *
 * @template T
 * @param {(() => Promise<T>) | Array<() => Promise<T>>} loaders loader(s) to run
 * @param {{outputs?: Record<string, string>,
 *   log?: (message: string) => void,
 *   exit?: (code: number) => void,
 *   env?: Record<string, string | undefined>,
 *   append?: (file: string, data: string) => void}} [options]
 * @returns {Promise<T | T[]>} loaded module(s), in the order given
 */
export async function bootstrapDependencies(loaders, options = {}) {
  const {
    outputs = {},
    log = console.error,
    exit = process.exit,
    env,
    append,
  } = options;
  const list = Array.isArray(loaders) ? loaders : [loaders];
  try {
    const loaded = [];
    for (const load of list) {
      loaded.push(await load());
    }
    return Array.isArray(loaders) ? loaded : loaded[0];
  } catch (error) {
    log(`::error::${error?.message ?? String(error)}`);
    if (error?.cause) {
      log(`::error::Cause: ${error.cause.message ?? String(error.cause)}`);
    }
    writeOutputs(outputs, { env, append });
    exit(1);
    // Only reached when `exit` is injected by a test and does not throw.
    throw error;
  }
}
