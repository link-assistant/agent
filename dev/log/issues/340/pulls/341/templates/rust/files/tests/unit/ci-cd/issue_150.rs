//! Regression tests for issue #150.
//!
//! `scripts/*.rs` carries 78 `#[test]` functions across nine rust-scripts, and
//! no workflow ran a single one of them. `cargo test` only builds the library
//! crate, so the release-script regression guards -- including the
//! rebase-before-stage ordering check in `version-and-commit.rs`, which exists
//! because a release once died with "cannot rebase: Your index contains
//! uncommitted changes" -- had never executed in CI.
//!
//! Two suites had rotted unnoticed as a direct consequence:
//!
//! * `create-github-release.rs` did not compile in test mode. It declared its
//!   `release_naming` module only under `#[cfg(not(test))]` and substituted
//!   `use super::release_naming`, a path that resolves to nothing when
//!   `rust-script --test` builds the file as its own crate root.
//! * `version-and-commit.rs` and `wait-for-crate.rs` failed under the
//!   workflow-level `RUSTFLAGS: -Dwarnings`, because a test harness has no
//!   `main`, so every helper reachable only from `main` is reported unused.
//!
//! These tests pin the fixes and the workflow step that would have caught them.

use std::fs;

fn repo_path(relative: &str) -> String {
    format!("{}/{relative}", env!("CARGO_MANIFEST_DIR"))
}

fn read(relative: &str) -> String {
    fs::read_to_string(repo_path(relative))
        .unwrap_or_else(|error| panic!("{relative} should be readable: {error}"))
        .replace("\r\n", "\n")
}

/// Scripts that carry an inline `#[cfg(test)]` module, i.e. exactly the set
/// `scripts/test-scripts.sh` selects.
fn scripts_with_tests() -> Vec<String> {
    let dir = repo_path("scripts");
    let mut names: Vec<String> = fs::read_dir(&dir)
        .expect("the scripts directory should exist")
        .map(|entry| entry.expect("script entry should be readable").path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("rs"))
        .filter(|path| {
            fs::read_to_string(path)
                .expect("script should be readable")
                .contains("cfg(test)")
        })
        .map(|path| {
            path.file_name()
                .expect("script should have a file name")
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// The defect: nothing in CI ever invoked `rust-script --test`.
#[test]
fn a_workflow_runs_the_release_script_unit_tests() {
    let release = read(".github/workflows/release.yml");

    assert!(
        release.contains("scripts/test-scripts.sh"),
        "release.yml must run scripts/test-scripts.sh; without it the inline \
         #[cfg(test)] suites under scripts/ never execute in CI"
    );
    assert!(
        release.contains("  script-tests:"),
        "release.yml should own a dedicated job for the release-script suites"
    );
}

/// A green run of a job nothing depends on would not stop a bad release.
#[test]
fn the_release_path_is_gated_on_the_script_tests() {
    let release = read(".github/workflows/release.yml");

    assert!(
        release.contains("needs: [javascript-first, lint, test, script-tests]"),
        "build must depend on script-tests, so a broken release script cannot \
         reach auto-release"
    );
    assert!(
        release.contains("needs.script-tests.result == 'success'"),
        "build's `if:` must require script-tests to have succeeded; `needs:` \
         alone is not enough under `!cancelled()`"
    );
    assert!(
        release.contains("      - script-tests\n"),
        "pipeline-status must observe script-tests, or a timeout in it would be \
         reported as a grey run instead of a failure"
    );
}

/// The runner must select suites the same way the reproduction in the issue
/// did, and must not stop at the first failing script.
#[test]
fn the_runner_covers_every_script_that_has_tests() {
    let runner = read("scripts/test-scripts.sh");

    assert!(
        runner.contains("for f in scripts/*.rs; do") && runner.contains("cfg(test)"),
        "the runner should discover suites by scanning scripts/*.rs for \
         cfg(test), so a newly added suite is picked up without edits here"
    );
    assert!(
        runner.contains("RUSTFLAGS"),
        "the runner must build under the same -Dwarnings the workflow sets, or \
         it will pass locally and fail in CI"
    );
    assert!(
        !runner.contains("set -euo pipefail"),
        "`set -e` would abort at the first failing suite and hide the state of \
         the rest; the runner collects failures instead"
    );

    let scripts = scripts_with_tests();
    assert_eq!(
        scripts.len(),
        19,
        "expected nineteen scripts with inline test suites, found: {scripts:?}"
    );
}

/// Bug 1: the module was declared only outside test builds.
#[test]
fn create_github_release_declares_release_naming_in_test_builds() {
    let script = read("scripts/create-github-release.rs");

    assert!(
        !script.contains("use super::release_naming"),
        "`super::release_naming` does not resolve when rust-script --test builds \
         this file as its own crate root"
    );
    assert!(
        script.contains("#[path = \"release-naming.rs\"]\nmod release_naming;"),
        "the release_naming module must be declared unconditionally so both the \
         script build and the test harness can see it"
    );
}

/// Bug 2: a test harness has no `main`, so `main`-only helpers look dead, and
/// the workflow-level `-Dwarnings` turns that into a compile error.
#[test]
fn scripts_whose_helpers_are_main_only_allow_dead_code_under_test() {
    for script in ["scripts/version-and-commit.rs", "scripts/wait-for-crate.rs"] {
        let body = read(script);
        assert!(
            body.contains("#![cfg_attr(test, allow(dead_code"),
            "{script} must allow dead code in test builds; without it \
             `RUSTFLAGS=-Dwarnings rust-script --test` fails to compile"
        );
        assert!(
            !body.contains("#![allow(dead_code)]"),
            "{script} should relax the lint only for test builds, so the real \
             script build still denies dead code"
        );
    }
}

/// The workflow-level `-Dwarnings` from `release.yml` is what turned the dead
/// helpers into hard errors; if it ever moves, the fixes above lose their point.
#[test]
fn the_release_workflow_still_denies_warnings() {
    assert!(
        read(".github/workflows/release.yml").contains("RUSTFLAGS: -Dwarnings"),
        "the -Dwarnings invariant these fixes are written against should hold"
    );
}
