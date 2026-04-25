//! Rust counterpart of `js/tests/process-name.js`.
//!
//! The JS suite verifies the agent process appears as `agent` in
//! `/proc/<pid>/comm` and `ps` output via `prctl(PR_SET_NAME)`. The Rust
//! binary is named `agent` at link time (`[[bin]] name = "agent"`), so
//! the kernel reports the correct comm name automatically without any
//! runtime intervention.
//!
//! These tests verify that contract: the compiled `agent` binary, when
//! invoked, presents itself with a stable identifying string in its
//! `--version` output.

use assert_cmd::Command;
use predicates::prelude::*;

fn agent_cmd() -> Command {
    Command::cargo_bin("agent").unwrap()
}

#[test]
fn agent_binary_reports_its_name_via_version() {
    agent_cmd()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("agent"));
}

#[test]
fn agent_binary_reports_its_name_via_help() {
    agent_cmd()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("agent"));
}

#[cfg(target_os = "linux")]
#[test]
fn linux_proc_comm_contains_agent_name() {
    use std::fs;
    use std::process::{Command as StdCommand, Stdio};
    use std::time::Duration;

    let mut child = StdCommand::new(env!("CARGO_BIN_EXE_agent"))
        .arg("--dry-run")
        .arg("-p")
        .arg("hello")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn agent for comm name check");

    // Give the kernel a moment to populate /proc/<pid>/comm
    std::thread::sleep(Duration::from_millis(200));

    let comm_path = format!("/proc/{}/comm", child.id());
    let comm = fs::read_to_string(&comm_path).unwrap_or_default();
    let _ = child.wait();

    let trimmed = comm.trim();
    assert_eq!(trimmed, "agent", "expected /proc/<pid>/comm to be 'agent'");
}
