//! Issue #135: `timeout-minutes` alone lets a slow job report `cancelled`
//! instead of `failed`.
//!
//! GitHub reports a job killed by `timeout-minutes` as `cancelled`, not
//! `failed`. On a non-default ref that is indistinguishable from a superseded
//! run, so a genuine timeout goes unnoticed. The fix is to give every long step
//! its own budget that expires *before* the job cap, which turns the timeout
//! into a real failure with an annotation naming the budget.
//!
//! These tests make "the budget expires before the cap" a checked invariant
//! rather than a per-job accident, so the next unbudgeted long step is caught
//! by CI instead of by an incident.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
// Every use of `Command` here drives the shell script, which the tests only
// exercise on non-Windows; an unconditional import would trip `-D warnings`.
#[cfg(not(windows))]
use std::process::Command;

/// A step budget may consume at most this share of its job's `timeout-minutes`.
/// The remainder pays for unbudgeted setup: checkout, toolchain install, cache
/// restore, tool installation. In the incident that motivated this issue the
/// setup cost 133 seconds and the runner cap beat the step budget by 1.3s.
const MAX_BUDGET_SHARE_PERCENT: u64 = 70;

/// `docker-build` builds through `docker/build-push-action`, a `uses:` step with
/// no shell command to wrap. It relies on `timeout-minutes` alone by design.
const BUDGET_EXEMPT_JOBS: &[&str] = &["docker-build"];

fn repo_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn workflow(name: &str) -> String {
    let path = repo_path(&format!(".github/workflows/{name}"));
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("workflow {} should exist: {error}", path.display()))
        .replace("\r\n", "\n")
}

fn workflow_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(repo_path(".github/workflows"))
        .expect("workflows directory should exist")
        .map(|entry| entry.expect("workflow entry").file_name())
        .filter(|name| {
            std::path::Path::new(name)
                .extension()
                .is_some_and(|extension| extension == "yml" || extension == "yaml")
        })
        .map(|name| name.to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert!(!names.is_empty(), "there should be at least one workflow");
    names
}

/// A job's YAML block: everything from its `  name:` key to the next key at the
/// same indentation. Jobs are the only two-space keys inside `jobs:`.
struct Job {
    name: String,
    body: String,
}

fn jobs(workflow: &str) -> Vec<Job> {
    let jobs_start = workflow
        .find("\njobs:\n")
        .map_or(0, |offset| offset + "\njobs:\n".len());
    let mut jobs: Vec<Job> = Vec::new();
    for line in workflow[jobs_start..].lines() {
        let is_job_header = line.starts_with("  ")
            && !line.starts_with("   ")
            && line.trim_end().ends_with(':')
            && !line.trim_start().starts_with('#');
        if is_job_header {
            let name = line.trim().trim_end_matches(':').to_owned();
            jobs.push(Job {
                name,
                body: String::new(),
            });
        } else if let Some(current) = jobs.last_mut() {
            current.body.push_str(line);
            current.body.push('\n');
        }
    }
    jobs
}

/// `timeout-minutes:` declared at job level (four-space indent), ignoring any
/// step-level override (which is more deeply indented).
fn job_timeout_minutes(body: &str) -> Option<u64> {
    body.lines()
        .filter(|line| line.starts_with("    timeout-minutes:") && !line.starts_with("     "))
        .find_map(|line| line.split(':').nth(1)?.trim().parse().ok())
}

/// Every `*_BUDGET_SECONDS: <n>` env value declared inside a job body.
fn budget_seconds(body: &str) -> Vec<(String, u64)> {
    body.lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let key = key.trim();
            key.ends_with("_BUDGET_SECONDS")
                .then(|| Some((key.to_owned(), value.trim().parse().ok()?)))?
        })
        .collect()
}

#[test]
fn every_job_declares_a_timeout_backstop() {
    for name in workflow_names() {
        let content = workflow(&name);
        for job in jobs(&content) {
            // A reusable-workflow call cannot declare timeout-minutes. Check
            // its local callee here; the outer loop checks every callee job.
            if let Some(callee) = job
                .body
                .lines()
                .find_map(|line| line.trim().strip_prefix("uses: ./.github/workflows/"))
            {
                let callee = callee.split_whitespace().next().unwrap();
                assert!(!jobs(&workflow(callee)).is_empty());
                continue;
            }
            assert!(
                job_timeout_minutes(&job.body).is_some(),
                "job {:?} in {name} has no timeout-minutes; an unbounded job can hang \
                 for the six-hour runner default and never report a failure",
                job.name
            );
        }
    }
}

#[test]
fn every_step_budget_expires_before_its_job_timeout() {
    for name in workflow_names() {
        let content = workflow(&name);
        for job in jobs(&content) {
            let budgets = budget_seconds(&job.body);
            if budgets.is_empty() {
                continue;
            }
            let cap_minutes = job_timeout_minutes(&job.body).unwrap_or_else(|| {
                panic!(
                    "budgeted job {:?} in {name} must declare timeout-minutes",
                    job.name
                )
            });
            let cap_seconds = cap_minutes * 60;

            // Steps in a job run sequentially under one job clock, so the sum of
            // the budgets -- not the largest one -- races the cap.
            let total: u64 = budgets.iter().map(|(_, seconds)| seconds).sum();
            let share = total * 100 / cap_seconds;
            let job_name = &job.name;
            assert!(
                total * 100 <= cap_seconds * MAX_BUDGET_SHARE_PERCENT,
                "job {job_name:?} in {name} budgets {total}s of a {cap_seconds}s cap \
                 ({share}%), above the {MAX_BUDGET_SHARE_PERCENT}% ceiling. The runner \
                 would win the race and report 'cancelled' instead of 'failure'. \
                 Budgets: {budgets:?}"
            );
        }
    }
}

#[test]
fn long_running_jobs_budget_their_steps() {
    let content = workflow("release.yml");
    let budgeted: BTreeMap<String, Vec<(String, u64)>> = jobs(&content)
        .into_iter()
        .map(|job| (job.name, budget_seconds(&job.body)))
        .collect();

    for job_name in ["test", "coverage", "fresh-merge"] {
        let budgets = budgeted
            .get(job_name)
            .unwrap_or_else(|| panic!("release.yml should define job {job_name:?}"));
        assert!(
            !budgets.is_empty(),
            "job {job_name:?} runs a long command and must wrap it in \
             scripts/run-with-budget-warning.sh so a timeout reports as a failure"
        );
    }

    for exempt in BUDGET_EXEMPT_JOBS {
        assert!(
            budgeted.contains_key(*exempt),
            "exemption list names job {exempt:?}, which no longer exists in release.yml"
        );
    }
}

#[test]
fn budgeted_steps_invoke_the_budget_runner() {
    let content = workflow("release.yml");
    for job in jobs(&content) {
        for (key, _) in budget_seconds(&job.body) {
            assert!(
                job.body
                    .contains(&format!("run-with-budget-warning.sh \"${key}\"")),
                "job {:?} declares {key} but does not pass it to \
                 scripts/run-with-budget-warning.sh, so nothing enforces it",
                job.name
            );
        }
    }
}

#[test]
fn cancelled_job_warning_points_at_the_timeout_annotation() {
    let script = fs::read_to_string(repo_path("scripts/check-pipeline-status.sh"))
        .expect("check-pipeline-status.sh should exist");
    assert!(
        script.contains("has exceeded the maximum execution time"),
        "the non-default-ref warning must name the annotation that distinguishes a \
         real timeout from a superseded run"
    );
}

// --- scripts/run-with-budget-warning.sh behaviour -------------------------

#[cfg(not(windows))]
fn run_budget_script(args: &[&str]) -> std::process::Output {
    run_budget_script_with_env(&[], args)
}

#[cfg(not(windows))]
fn run_budget_script_with_env(env: &[(&str, &str)], args: &[&str]) -> std::process::Output {
    let mut command = Command::new("bash");
    command
        .arg(repo_path("scripts/run-with-budget-warning.sh"))
        .args(args)
        .env("BUDGET_GRACE_SECONDS", "1");
    for (key, value) in env {
        command.env(key, value);
    }
    command.output().expect("budget script should run")
}

#[test]
#[cfg(not(windows))]
fn successful_command_passes_through_its_output_and_status() {
    let output = run_budget_script(&["30", "Fast step", "echo", "done"]);
    assert!(output.status.success(), "fast command should succeed");
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "done");
}

#[test]
#[cfg(not(windows))]
fn failing_command_keeps_its_own_exit_status() {
    let output = run_budget_script(&["30", "Failing step", "sh", "-c", "exit 7"]);
    assert_eq!(output.status.code(), Some(7));
}

#[test]
#[cfg(not(windows))]
fn exceeding_the_budget_fails_with_an_annotated_error() {
    let output = run_budget_script(&["2", "Slow step", "sleep", "60"]);
    // 124 matches timeout(1)'s convention for "killed by the deadline".
    assert_eq!(output.status.code(), Some(124));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("::error title=Slow step exceeded its execution budget::"),
        "a blown budget must annotate as an error so the job reports failure, got: {stdout}"
    );
    assert!(
        stdout.contains("::warning title=Slow step is approaching its execution budget::"),
        "the warning must fire before the budget expires, got: {stdout}"
    );
}

#[test]
#[cfg(not(windows))]
fn a_missing_command_is_a_usage_error() {
    let output = run_budget_script(&["30", "No command"]);
    assert_eq!(output.status.code(), Some(2));
}

#[test]
#[cfg(not(windows))]
fn a_non_numeric_budget_is_a_usage_error() {
    let output = run_budget_script(&["twenty", "Bad budget", "true"]);
    assert_eq!(output.status.code(), Some(2));
}

// --- issue #153: the budget must be measured by a clock, not by polls -------
//
// The loop used to count poll iterations (`elapsed=$(( elapsed + POLL_SECONDS ))`).
// A non-integer BUDGET_POLL_SECONDS aborted the arithmetic every iteration while
// the loop kept running with `elapsed` frozen at 0, so the budget never expired
// and the job cap fired first -- reported as 'cancelled', hiding the failure.

#[test]
#[cfg(not(windows))]
fn a_fractional_poll_interval_still_expires_the_budget() {
    let output = run_budget_script_with_env(
        &[("BUDGET_POLL_SECONDS", "0.5")],
        &["2", "Half-second polls", "sleep", "60"],
    );
    assert_eq!(output.status.code(), Some(124));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("::error title=Half-second polls exceeded its execution budget::"),
        "a fractional poll interval must not stop the budget from expiring, got: {stdout}"
    );
}

#[test]
#[cfg(not(windows))]
fn a_non_numeric_poll_interval_is_a_usage_error_not_a_silent_never_expiring_budget() {
    // Under the old counter arithmetic this configuration silently ran to the
    // child's own completion (exit 0 here) with the budget frozen at zero.
    let output = run_budget_script_with_env(
        &[("BUDGET_POLL_SECONDS", "abc")],
        &["1", "Bad poll", "true"],
    );
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("BUDGET_POLL_SECONDS"),
        "the usage error must name the knob that was rejected, got: {stderr}"
    );
}

#[test]
#[cfg(not(windows))]
fn a_zero_or_malformed_poll_interval_is_a_usage_error() {
    for poll in ["0", "0.0", "0.5.5", ".5", "1.", "-1"] {
        let output = run_budget_script_with_env(
            &[("BUDGET_POLL_SECONDS", poll)],
            &["1", "Bad poll", "true"],
        );
        assert_eq!(
            output.status.code(),
            Some(2),
            "BUDGET_POLL_SECONDS={poll} should be rejected as a usage error"
        );
    }
}

#[test]
#[cfg(not(windows))]
fn the_timeout_annotation_reports_the_measured_overrun() {
    // A coarse 2s poll against a 1s budget: the budget is detected on the next
    // poll, and the annotation must report the real elapsed time, not just the
    // configured budget.
    let output = run_budget_script_with_env(
        &[("BUDGET_POLL_SECONDS", "2")],
        &["1", "Coarse polls", "sleep", "60"],
    );
    assert_eq!(output.status.code(), Some(124));
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Process inspection and runner scheduling may add time to the 2s poll.
    // Check the measured overrun without requiring an exact wall-clock value.
    let elapsed = stdout
        .split_once("Coarse polls ran for ")
        .and_then(|(_, annotation)| annotation.split_once("s against its 1s budget"))
        .and_then(|(seconds, _)| seconds.parse::<u64>().ok());
    assert!(
        elapsed.is_some_and(|seconds| seconds >= 2),
        "the error annotation should report the measured elapsed time against \
         the configured budget, got: {stdout}"
    );
}

#[test]
#[cfg(not(windows))]
fn every_arithmetic_knob_is_validated_before_the_loop() {
    // All three knobs land in bash arithmetic; a non-integer in any of them
    // aborts the expression and leaves the loop with a frozen clock.
    for (key, value) in [
        ("BUDGET_POLL_SECONDS", "fast"),
        ("BUDGET_WARN_PERCENT", "seventy"),
        ("BUDGET_GRACE_SECONDS", "1.5"),
    ] {
        let output = run_budget_script_with_env(&[(key, value)], &["5", "Bad knob", "true"]);
        assert_eq!(
            output.status.code(),
            Some(2),
            "{key}={value} should be rejected before the loop starts"
        );
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains(key),
            "the rejection should name {key}, got: {stderr}"
        );
    }
}

/// `cargo test` and `cargo nextest` spawn a process tree. Terminating only the
/// direct child leaves orphans that keep the runner busy until the job cap
/// fires -- the exact failure this script exists to prevent.
#[test]
#[cfg(not(windows))]
fn the_whole_process_group_is_terminated_not_just_the_direct_child() {
    let marker = std::env::temp_dir().join(format!("issue-135-group-{}", std::process::id()));
    let _ = fs::remove_file(&marker);
    let spawner = format!(
        "sleep 120 & echo $! > {marker}; sleep 120",
        marker = marker.display()
    );

    let output = run_budget_script(&["2", "Tree", "sh", "-c", &spawner]);
    assert_eq!(output.status.code(), Some(124));

    let grandchild: i32 = fs::read_to_string(&marker)
        .expect("grandchild pid should be recorded")
        .trim()
        .parse()
        .expect("grandchild pid should parse");
    let _ = fs::remove_file(&marker);

    // A killed-but-unreaped child is a zombie, and `kill -0` succeeds on those.
    // Ask `ps` for the process state instead so the check is meaningful.
    let state = Command::new("ps")
        .args(["-o", "stat=", "-p", &grandchild.to_string()])
        .output()
        .expect("ps should run");
    let state = String::from_utf8_lossy(&state.stdout).trim().to_owned();
    assert!(
        state.is_empty() || state.starts_with('Z'),
        "grandchild {grandchild} survived the budget kill in state {state:?}; \
         the command must run in its own process group"
    );
}
