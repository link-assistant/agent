//! Regression tests for issue #157.
//!
//! `simulate-fresh-merge.sh` runs under `set -euo pipefail`, so a single failed
//! `git fetch` aborted the whole job before any check ran. GitHub's fetch
//! endpoint does shed load, and CI address ranges see that more than a laptop
//! does, so the fetch now retries with linear backoff before giving up.

use std::fs;
#[cfg(not(windows))]
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::Command;

fn script() -> String {
    fs::read_to_string(format!(
        "{}/scripts/simulate-fresh-merge.sh",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("simulate-fresh-merge.sh should exist")
    .replace("\r\n", "\n")
}

#[test]
fn the_bare_fetch_only_happens_inside_the_retry_wrapper() {
    let script = script();
    assert!(
        script.contains("fetch_with_retry()"),
        "the fetch should live in a retry wrapper"
    );
    assert!(
        script.matches("git fetch --no-tags").count() == 1,
        "the only `git fetch --no-tags` call should be the one inside fetch_with_retry"
    );
    assert!(
        script.contains("\nfetch_with_retry\n"),
        "the main path must call fetch_with_retry instead of fetching bare"
    );
}

#[test]
fn the_retry_policy_matches_the_documented_defaults() {
    let script = script();
    assert!(
        script.contains("FRESH_MERGE_FETCH_ATTEMPTS:-5"),
        "the fetch should be attempted up to five times by default"
    );
    assert!(
        script.contains("FRESH_MERGE_RETRY_DELAY_SECONDS:-5"),
        "the backoff should start at five seconds by default"
    );
    assert!(
        script.contains("sleep $(( FRESH_MERGE_RETRY_DELAY_SECONDS * attempt ))"),
        "retries should back off linearly, not hammer the remote"
    );
    assert!(
        script.contains("::error::Could not fetch origin/"),
        "an exhausted retry budget must annotate an error, not exit silently"
    );
}

// --- behaviour: a stand-in `git` that fails the first N fetches -------------

#[cfg(not(windows))]
fn temp_root(tag: &str) -> PathBuf {
    // Tests in one binary share a process id, so the thread id is what keeps
    // concurrent runs out of each other's way.
    let thread = format!("{:?}", std::thread::current().id())
        .replace(|character: char| !character.is_ascii_alphanumeric(), "");
    let dir = std::env::temp_dir().join(format!("{tag}-{}-{thread}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp root should be creatable");
    dir
}

#[cfg(not(windows))]
fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .status()
        .expect("git should run");
    assert!(
        status.success(),
        "git {args:?} should succeed in {}",
        dir.display()
    );
}

/// A `git` shim that fails the first `fail_times` fetches and then delegates to
/// the real git, so the script's retry loop is exercised end to end.
#[cfg(not(windows))]
fn install_flaky_git_shim(bin_dir: &Path, real_git: &str, fail_times: u32) {
    let shim = format!(
        "#!/bin/sh\n\
         if [ \"$1\" = \"fetch\" ]; then\n\
         \x20 count_file=\"{count_file}\"\n\
         \x20 count=$(cat \"$count_file\" 2>/dev/null || echo 0)\n\
         \x20 count=$((count + 1))\n\
         \x20 echo \"$count\" > \"$count_file\"\n\
         \x20 if [ \"$count\" -le \"{fail_times}\" ]; then\n\
         \x20\x20\x20 echo \"shim: fetch attempt $count failed\" >&2\n\
         \x20\x20\x20 exit 1\n\
         \x20 fi\n\
         fi\n\
         exec \"{real_git}\" \"$@\"\n",
        count_file = bin_dir.join("fetch-count").display(),
        fail_times = fail_times,
        real_git = real_git,
    );
    let shim_path = bin_dir.join("git");
    fs::write(&shim_path, shim).expect("shim should be writable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&shim_path, fs::Permissions::from_mode(0o755))
            .expect("shim should be chmod-able");
    }
}

#[cfg(not(windows))]
fn find_git() -> String {
    let output = Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .expect("sh should run");
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// Build `origin` (a repo with a `main` commit) and a clone of it on a feature
/// branch, then run the script from the clone with the shim's bin dir first on
/// PATH. `FRESH_MERGE_CHECKS=true` keeps the merged-tree checks to a no-op.
#[cfg(not(windows))]
fn run_script_with_flaky_git(fail_times: u32) -> std::process::Output {
    let root = temp_root("issue-157");
    let origin = root.join("origin");
    let clone = root.join("clone");
    let bin = root.join("bin");
    fs::create_dir_all(&origin).expect("origin dir should be creatable");
    fs::create_dir_all(&bin).expect("bin dir should be creatable");

    git(&origin, &["-c", "init.defaultBranch=main", "init"]);
    fs::write(origin.join("README.md"), "base\n").expect("README should be writable");
    git(&origin, &["add", "README.md"]);
    git(&origin, &["commit", "-m", "base"]);
    git(
        &origin,
        &[
            "clone",
            "--no-local",
            ".",
            clone.to_str().expect("clone path is utf8"),
        ],
    );
    fs::write(clone.join("feature.txt"), "feature\n").expect("feature file should be writable");
    git(&clone, &["add", "feature.txt"]);
    git(&clone, &["commit", "-m", "feature"]);

    install_flaky_git_shim(&bin, &find_git(), fail_times);

    let output = Command::new("bash")
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/simulate-fresh-merge.sh"))
        .env("GITHUB_BASE_REF", "main")
        .env("FRESH_MERGE_CHECKS", "true")
        // Short backoff so the retry loop does not dominate the test run.
        .env("FRESH_MERGE_RETRY_DELAY_SECONDS", "1")
        .env("FRESH_MERGE_FETCH_ATTEMPTS", "5")
        .env(
            "PATH",
            format!(
                "{}:{}",
                bin.display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .current_dir(&clone)
        .output()
        .expect("the fresh-merge script should run");

    let _ = fs::remove_dir_all(&root);
    output
}

#[test]
#[cfg(not(windows))]
fn a_transient_fetch_failure_is_retried_and_the_simulation_succeeds() {
    let output = run_script_with_flaky_git(2);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "two failed fetches should be survived by the retry loop; stdout: {stdout} stderr: {stderr}"
    );
    assert!(
        stdout.contains("attempt 1 of 5") || stderr.contains("attempt 1 of 5"),
        "the retry should announce itself, got: {stdout}{stderr}"
    );
}

#[test]
#[cfg(not(windows))]
fn a_permanently_failing_fetch_fails_loudly_after_the_maximum_attempts() {
    let output = run_script_with_flaky_git(999);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(
        output.status.code(),
        Some(1),
        "an unreachable base ref must fail the job; stdout: {stdout} stderr: {stderr}"
    );
    let combined = format!("{stdout}{stderr}");
    assert!(
        combined.contains("after 5 attempts"),
        "the error should name the exhausted attempt count, got: {combined}"
    );
    assert!(
        combined.contains("::error::"),
        "the failure should be annotated for the job summary, got: {combined}"
    );
    assert!(
        !combined.contains("Merge succeeded"),
        "no check should run when the base ref could not be fetched, got: {combined}"
    );
}

#[test]
#[cfg(not(windows))]
fn a_malformed_retry_knob_is_a_usage_error() {
    let script_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/simulate-fresh-merge.sh");
    let output = Command::new("bash")
        .arg(&script_path)
        .env("GITHUB_BASE_REF", "main")
        .env("FRESH_MERGE_FETCH_ATTEMPTS", "five")
        .output()
        .expect("the fresh-merge script should run");
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("FRESH_MERGE_FETCH_ATTEMPTS"),
        "the usage error should name the rejected knob, got: {stderr}"
    );
}
