//! Regression test for issue #172: a command root may return while a worker
//! remains alive holding the stdout inherited from the CI step.

#![cfg(target_os = "linux")]

use std::fs;
use std::process::Command;

#[test]
fn a_surviving_worker_cannot_hold_the_callers_pipeline_open() {
    let marker = format!("issue-172-survivor-{}", std::process::id());
    let dir = std::env::temp_dir().join(&marker);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create fixture directory");
    let command = dir.join("command.sh");
    fs::write(
        &command,
        format!("#!/usr/bin/env bash\nsh -c 'sleep 20' {marker} &\necho root-finished\nexit 0\n"),
    )
    .expect("write worker fixture");

    let pipeline = format!(
        "BUDGET_POLL_SECONDS=0.1 BUDGET_STATE_PARENT={} \
         bash scripts/run-with-budget-warning.sh 3 'worker probe' bash {} 2>&1 | tee /dev/null",
        dir.display(),
        command.display()
    );
    let output = Command::new("timeout")
        .args(["6", "bash", "-c", &pipeline])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run pipeline fixture");

    let _ = Command::new("pkill").args(["-f", &marker]).status();
    let _ = fs::remove_dir_all(&dir);

    assert!(
        output.status.success(),
        "the wrapper returned but a survivor kept its stdout pipe open: status={:?} stdout={} stderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
