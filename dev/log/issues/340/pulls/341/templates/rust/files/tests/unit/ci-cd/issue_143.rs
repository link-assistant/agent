//! Regression tests for issue #143.
//!
//! `scripts/wait-for-crate.rs` returned a bare `bool` from its crates.io probe,
//! so a 403, 429 or 5xx was indistinguishable from "this version is not
//! published yet". A throttled probe exhausted every attempt and the workflow
//! failed with `<crate>@<version> was not visible on crates.io`, pointing the
//! reader at a publish step that had actually succeeded.
//!
//! The behavioural assertions live next to the code, in the `tests` module of
//! `scripts/wait-for-crate.rs` (compiled into this test binary through
//! `tests/unit/ci-cd/mod.rs`). What is checked here is that the release
//! workflow keeps using that script, and that the script keeps probing the
//! artifact `cargo` actually resolves against.

use std::fs;

fn read(relative_path: &str) -> String {
    fs::read_to_string(format!("{}/{relative_path}", env!("CARGO_MANIFEST_DIR")))
        .unwrap_or_else(|error| panic!("{relative_path} should exist: {error}"))
        .replace("\r\n", "\n")
}

/// A `bool` cannot carry "crates.io did not answer", so the probe must not
/// return one.
#[test]
fn crate_visibility_is_not_a_boolean() {
    let script = read("scripts/wait-for-crate.rs");

    assert!(
        script.contains("enum Visibility"),
        "the crates.io probe must distinguish an unanswered request from a missing version"
    );
    assert!(
        script.contains("Visibility::Unknown"),
        "a probe that could not be completed must be reported as unknown"
    );
    assert!(
        !script.contains("fn crate_version_exists(crate_name: &str, version: &str) -> bool"),
        "the boolean probe from issue #143 must be gone"
    );
}

/// `cargo` resolves dependencies against the sparse index, and the index is not
/// rate limited, so that is the primary source of truth.
#[test]
fn visibility_is_probed_against_the_sparse_index() {
    let script = read("scripts/wait-for-crate.rs");

    assert!(
        script.contains("https://index.crates.io/"),
        "the wait should consult the sparse index, which is what cargo resolves against"
    );
    assert!(
        script.contains("fn index_body_has_version"),
        "the sparse index returns 200 for any existing crate, so the version must be \
         matched inside the body rather than inferred from the status"
    );
}

/// crates.io answers 403 to clients that do not identify themselves, and asks
/// that the contact address be reachable.
#[test]
fn user_agent_identifies_the_client_and_its_owner() {
    let script = read("scripts/wait-for-crate.rs");

    assert!(
        script.contains(
            "rust-script-wait-for-crate (+https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)"
        ),
        "the User-Agent must name the tool and a reachable contact URL"
    );
}

/// The release workflow must keep running the wait; the fix is worthless if the
/// step is dropped.
#[test]
fn release_workflow_still_waits_for_crate_visibility() {
    let release = read(".github/workflows/release.yml");

    assert!(
        release.contains("rust-script scripts/wait-for-crate.rs --release-version"),
        "release.yml must wait for crates.io visibility before publishing images"
    );
}
