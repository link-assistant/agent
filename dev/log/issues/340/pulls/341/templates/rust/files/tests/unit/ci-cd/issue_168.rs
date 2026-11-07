//! Regression tests for issue #168:
//! <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/168>
//!
//! lychee's `--max-retries` cannot retry a connection reset during connect
//! (lycheeverse/lychee#2297), so a healthy URL behind a RST -- routine for a
//! rate-limiting host seen from a CI address range -- is reported broken
//! without a single retry. The workflow now re-asks exactly those URLs
//! outside lychee and downgrades the ones that answer healthy; a failure
//! carrying a status code is a host's answer and stays final.

use std::fs;
use std::path::{Path, PathBuf};

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn read(relative: &str) -> String {
    fs::read_to_string(repo_path(relative))
        .unwrap_or_else(|error| panic!("{relative} should exist: {error}"))
        .replace("\r\n", "\n")
}

fn links_yml() -> String {
    read(".github/workflows/links.yml")
}

fn step_block<'a>(job: &'a str, step_name: &str) -> &'a str {
    let marker = format!("- name: {step_name}\n");
    let start = job
        .find(&marker)
        .unwrap_or_else(|| panic!("step {step_name:?} should exist"));
    let rest = &job[start + marker.len()..];
    let end = rest.find("\n      - name: ").unwrap_or(rest.len());
    &rest[..end]
}

/// The re-check runs only on a lychee failure and writes its verdict where
/// the downstream steps read it.
#[test]
fn the_recheck_step_runs_only_when_lychee_failed() {
    let workflow = links_yml();
    let job = workflow
        .split("\njobs:\n")
        .nth(1)
        .expect("links.yml should declare jobs");
    let step = step_block(job, "Re-check unanswered and transient links");

    assert!(step.contains("if: steps.lychee.outputs.exit_code != 0"));
    assert!(step.contains("id: recheck"));
    assert!(step.contains("run: node scripts/recheck-broken-links.mjs"));
    assert!(step.contains("LYCHEE_OUTPUT: lychee/out.md"));
    assert!(step.contains("RECOVERED_OUTPUT: lychee/recovered.txt"));
}

/// The re-check must judge a URL by the same rules lychee used: it reads the
/// --accept list and --user-agent out of links.yml itself, so the two sides
/// cannot drift apart.
#[test]
fn the_recheck_judges_urls_by_lychees_own_rules() {
    let script = read("scripts/recheck-broken-links.mjs");

    assert!(script.contains("readFileSync('.github/workflows/links.yml', 'utf8')"));
    assert!(script.contains("extractLycheeRequestOptions(workflowText)"));
    // lychee's documented defaults, for when the workflow sets neither flag.
    assert!(script.contains("const ACCEPT_DEFAULT = '100..=103,200..=299';"));
    assert!(script.contains("const USER_AGENT_DEFAULT = 'lychee';"));
}

/// The gate output is written only when every unanswered link recovered --
/// one link still broken keeps the run red.
#[test]
fn the_gate_releases_only_on_a_complete_recovery() {
    let script = read("scripts/recheck-broken-links.mjs");

    assert!(script.contains("result.stillBroken.length === 0"));
    assert!(script.contains("result.recovered.length === unansweredCount"));
    assert!(script.contains("finalFailureCount === 0"));
    assert!(script.contains("'all_recovered=true\\n'"));
}

/// The re-check only ever downgrades failures, so a bug in it must not be
/// able to turn a green run red: any crash exits 0 and reads as "no
/// recovery".
#[test]
fn a_crash_in_the_recheck_reads_as_no_recovery() {
    let script = read("scripts/recheck-broken-links.mjs");

    assert!(script.contains("Re-check crashed (treating as no recovery)"));
    assert!(script.contains("process.exit(0)"));
    assert!(script.contains("This script downgrades failures"));
    // The defaults must expire well before the job's 10-minute cap.
    assert!(script.contains("const BUDGET_SECONDS_DEFAULT = 240;"));
    assert!(script.contains("const REQUEST_TIMEOUT_MS = 30_000;"));
}

/// A URL the re-check recovered must not reach the Wayback Machine as
/// "broken": the archive lookup skips the recovered list entirely.
#[test]
fn the_wayback_lookup_skips_recovered_urls() {
    let script = read("scripts/check-web-archive.mjs");

    assert!(script.contains("export function splitRecoveredUrls"));
    assert!(script.contains("process.env.RECOVERED_URLS || 'lychee/recovered.txt'"));
}
