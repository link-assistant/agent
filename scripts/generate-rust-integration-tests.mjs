#!/usr/bin/env node
// Generate Rust integration test counterparts for every JS integration test
// so both languages have parallel test files with the same base names.
// This script is idempotent: it skips files that already exist.

import { readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsIntegrationDir = join(repoRoot, 'js/tests/integration');
const rustTestsDir = join(repoRoot, 'rust/tests');

function jsToRustName(jsName) {
  // bash.tools.js -> integration_bash_tools.rs
  // plaintext.input.js -> integration_plaintext_input.rs
  const stem = jsName.replace(/\.js$/, '');
  const rustStem = stem.replace(/[.\-]/g, '_');
  return `integration_${rustStem}.rs`;
}

const jsFiles = readdirSync(jsIntegrationDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

let created = 0;
let skipped = 0;

for (const jsFile of jsFiles) {
  const rustFile = jsToRustName(jsFile);
  const rustPath = join(rustTestsDir, rustFile);

  if (existsSync(rustPath)) {
    skipped += 1;
    continue;
  }

  const stem = jsFile.replace(/\.js$/, '');
  const featureName = stem.replace(/\.tools$/, '').replace(/[.\-]/g, ' ');
  const content = `//! Rust counterpart of \`js/tests/integration/${jsFile}\`.
//!
//! The JS suite covers the ${featureName} integration path against the
//! live agent runtime. The Rust port shares the same CLI surface but the
//! live runtime integrations land incrementally; this file pins the base
//! name so the JS and Rust test trees stay aligned.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn dry_run_completes_without_credentials() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--dry-run", "-p", "hello"])
        .env_remove("OPENROUTER_API_KEY")
        .env_remove("GROQ_API_KEY")
        .env_remove("ANTHROPIC_API_KEY")
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn agent_help_runs_cleanly() {
    Command::cargo_bin("agent")
        .unwrap()
        .arg("--help")
        .assert()
        .success();
}
`;

  writeFileSync(rustPath, content);
  created += 1;
  console.log(`Created ${rustFile} for ${jsFile}`);
}

console.log(`\nDone: ${created} created, ${skipped} skipped (already existed).`);
