#!/usr/bin/env node
// Compare committed values at the merge base, never worktree formatting.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCrateInfo } from './rust-package-info.mjs';
import { git, getPrComparison } from './pr-comparison.mjs';

export function checkVersions(before, after) {
  for (const manifest of ['js/package.json', 'rust/Cargo.toml']) {
    const version = (text) =>
      manifest.endsWith('.json')
        ? JSON.parse(text).version
        : parseCrateInfo(text).version;
    if (version(before(manifest)) !== version(after(manifest))) {
      throw new Error(
        `Manual version change in ${manifest}; add a changeset/changelog fragment. CI manages versions.`
      );
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const { mergeBase, head } = getPrComparison();
    checkVersions(
      (file) => git(['show', `${mergeBase}:${file}`]),
      (file) => git(['show', `${head}:${file}`])
    );
    console.log(
      'Package versions unchanged; release metadata is managed by CI.'
    );
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
