#!/usr/bin/env node

/**
 * Fails the release before any install when the package manager could be
 * detected as anything other than npm.
 *
 * `package-manager-detector` (used by changesets 3.x formatting, nypm and
 * friends) probes the known lockfiles in table order, and the non-npm
 * lockfiles come before `package-lock.json`. This repository keeps
 * `deno.lock` at the root because the Deno leg of the test matrix runs
 * `deno test` there. Without a declaration, package-manager-mediated
 * commands such as Prettier would be launched through Deno.
 * A `devEngines.packageManager` (or `packageManager`) declaration is
 * honoured ahead of the lockfile table, keeping those commands on npm.
 *
 * Formatter selection is separate: Changesets detects any deno.json before
 * Prettier and invokes Deno directly, bypassing the package manager. The
 * explicit `format: "prettier"` in .changeset/config.json prevents that.
 *
 * The check is dependency-free on purpose: it runs ahead of
 * `npm install` in the versioning job, when node_modules may not exist.
 *
 * Exit codes: 0 = declared npm (warnings allowed), 1 = the release would
 * detect a wrong package manager or none.
 */

import { existsSync, readFileSync } from 'node:fs';

/** Every lockfile (and marker file) the detector probes before package-lock.json. */
const FOREIGN_LOCKFILES = [
  'aube-lock.yaml',
  'aube-workspace.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'nub.lock',
  'upm.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
];

/** Runtime lockfiles are intentional when their owning config exists. */
const RUNTIME_LOCKFILES = {
  'deno.lock': ['deno.json', 'deno.jsonc'],
};

/** The only agent the release flow (npm install, npm x prettier) works with. */
const EXPECTED = 'npm';

/**
 * `packageManager` carries a version ("npm@10.9.1", or "@scope/pkg@1.0.0");
 * `devEngines.packageManager.name` is the bare name.
 * @param {string} value
 * @returns {string}
 */
function parsePackageManagerName(value) {
  if (value.startsWith('@')) {
    const lastAt = value.lastIndexOf('@');

    return lastAt > 0 ? value.slice(0, lastAt) : value;
  }

  return value.split('@')[0];
}

function main() {
  let pkg;

  try {
    pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  } catch (error) {
    console.error(`::error::cannot read package.json: ${error.message}`);
    process.exit(1);
  }

  const rawDeclared =
    pkg.packageManager ?? pkg.devEngines?.packageManager?.name ?? '';
  const declared = rawDeclared ? parsePackageManagerName(rawDeclared) : '';
  const errors = [];

  if (!declared) {
    errors.push(
      'package.json declares neither "packageManager" nor ' +
        '"devEngines.packageManager"; package-manager-detector falls back to ' +
        'the lockfile table, where non-npm lockfiles are probed first.'
    );
  } else if (declared !== EXPECTED) {
    errors.push(
      `package.json declares package manager "${declared}", but this ` +
        `template's release flow requires "${EXPECTED}".`
    );
  }

  const foreign = FOREIGN_LOCKFILES.filter((lock) => existsSync(lock));
  const runtimeConfigs = new Map(
    foreign.map((lock) => [
      lock,
      (RUNTIME_LOCKFILES[lock] ?? []).find((config) => existsSync(config)),
    ])
  );
  const unexpected = foreign.filter((lock) => !runtimeConfigs.get(lock));

  if (declared === EXPECTED && unexpected.length > 0) {
    console.warn(
      `::warning::lockfile(s) for another package manager at the repository ` +
        `root: ${unexpected.join(', ')}. The npm declaration outranks them, but ` +
        'any tool embedding the same lockfile table without reading the ' +
        'declaration will pick the wrong agent.'
    );
  }

  if (errors.length > 0) {
    console.error('Package manager declaration check failed:');
    console.error(errors.map((error) => `  - ${error}`).join('\n'));

    if (foreign.length > 0) {
      console.error(
        `  - Lockfile(s) for another package manager at the repository ` +
          `root: ${foreign.join(', ')}.`
      );
    }

    process.exit(1);
  }

  const foreignNote =
    foreign.length > 0
      ? `${foreign.length} foreign lockfile(s) present (outranked by the declaration): ${foreign.map((lock) => (runtimeConfigs.get(lock) ? `${lock} (kept by Deno for ${runtimeConfigs.get(lock)})` : lock)).join(', ')}.`
      : 'no foreign lockfiles.';

  console.log(
    `Package manager check passed: declared "${rawDeclared}", ${foreignNote}`
  );
}

main();
