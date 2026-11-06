#!/usr/bin/env node

// Compare committed JSON values, so formatting changes do not request releases.
// Git/ref/JSON errors fail the guard. Only same-repository release PRs from the
// configured release actor (github-actions[bot] by default) are exempt.
import {
  getJsRoot,
  getPackageJsonPath,
  parseJsRootConfig,
} from './js-paths.mjs';
import { parsePackageInfo } from './package-info.mjs';
import { getPrComparison, git, isTrustedReleasePr } from './pr-comparison.mjs';

try {
  const { mergeBase, head } = getPrComparison();
  const jsRoot = getJsRoot({ jsRoot: parseJsRootConfig() });
  const manifest = getPackageJsonPath({ jsRoot })
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
  const before = parsePackageInfo(
    git(['show', `${mergeBase}:${manifest}`]),
    manifest
  );
  const after = parsePackageInfo(
    git(['show', `${head}:${manifest}`]),
    manifest
  );
  if (before.version !== after.version && !isTrustedReleasePr()) {
    throw new Error(
      `Manual version change in ${manifest}: ${before.version} -> ${after.version}. Add a changeset; CI manages versions.`
    );
  }
  console.log('No manual version changes detected - check passed');
} catch (error) {
  console.error(`::error::Version check failed: ${error.message}`);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exitCode = 1;
}
