//! Regression tests for issue #171: a moved branch only explains a cancelled
//! job when that job could actually be cancelled by a superseding run.

#![cfg(not(windows))]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "rust-template-{label}-{}-{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create fixture directory");
    path
}

fn run_gate(workflow: &Path, job: &str) -> std::process::Output {
    Command::new("bash")
        .arg("scripts/check-pipeline-status.sh")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env(
            "NEEDS_JSON",
            format!(r#"{{"{job}":{{"result":"cancelled"}}}}"#),
        )
        .env("IS_MAIN", "true")
        .env("GITHUB_REF", "refs/heads/main")
        .env("RUN_SHA", "1111111111111111111111111111111111111111")
        .env("BRANCH_REF", "main")
        .env(
            "BRANCH_HEAD_SHA",
            "2222222222222222222222222222222222222222",
        )
        .env("WORKFLOW_FILE", workflow)
        .output()
        .expect("run pipeline status gate")
}

#[test]
fn a_superseded_run_does_not_excuse_a_non_cancellable_job() {
    let dir = temp_dir("issue-171-false");
    let workflow = dir.join("workflow.yml");
    fs::write(
        &workflow,
        "jobs:\n  publish:\n    concurrency:\n      group: release\n      cancel-in-progress: false\n",
    )
    .expect("write workflow fixture");

    let output = run_gate(&workflow, "publish");
    let _ = fs::remove_dir_all(dir);

    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("cancel-in-progress: false"),
        "the gate should explain why the moved branch is not an excuse: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[test]
fn a_superseded_run_excuses_only_a_cancellable_job() {
    let dir = temp_dir("issue-171-true");
    let workflow = dir.join("workflow.yml");
    fs::write(
        &workflow,
        "jobs:\n  test:\n    concurrency:\n      group: tests\n      cancel-in-progress: true\n",
    )
    .expect("write workflow fixture");

    let output = run_gate(&workflow, "test");
    let _ = fs::remove_dir_all(dir);

    assert!(
        output.status.success(),
        "a moved branch explains a cancellable job: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn expressions_and_missing_concurrency_fail_closed() {
    let dir = temp_dir("issue-171-unknown");
    let workflow = dir.join("workflow.yml");
    fs::write(
        &workflow,
        "jobs:\n  expression:\n    concurrency:\n      group: tests\n      cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n  none:\n    runs-on: ubuntu-latest\n",
    )
    .expect("write workflow fixture");

    for job in ["expression", "none", "missing"] {
        let output = run_gate(&workflow, job);
        assert_eq!(
            output.status.code(),
            Some(1),
            "{job} must not turn an unproven cancellation into a pass: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let _ = fs::remove_dir_all(dir);
}
