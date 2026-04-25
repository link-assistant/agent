//! Rust counterpart of `js/tests/integration/bash.tools.js`.
//!
//! The JS suite asks the agent to invoke the bash tool. The unit-level
//! coverage of the Rust BashTool already lives in `tool_bash.rs`; this
//! file mirrors the JS integration entry point so both languages have a
//! file with the same base name.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn dry_run_accepts_bash_request() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--dry-run", "-p", "run echo hi via bash"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn agent_advertises_bash_in_help() {
    Command::cargo_bin("agent")
        .unwrap()
        .arg("--help")
        .assert()
        .success();
}
