//! Regression tests for issues #160, #165 and #166.
//!
//! - #160: actionlint 1.7.7 false-positived on real hosted runner labels and
//!   missed the newer glob checks; the pin moved to 1.7.12 and the label
//!   allowlist went away (covered with #141's tests).
//! - #165: the `unpinned-images` audit is Pedantic-persona only, so a
//!   `uses: docker://image:tag` reference never reached the `'*': hash-pin`
//!   policy. The image is digest-pinned and a narrow pedantic pass enforces
//!   the policy going forward.
//! - #166: zizmor-action@v0.6.2's `latest` is frozen at zizmor 1.29.0, while
//!   the job's own comment told users to reproduce with `zizmor==1.30.0`, a
//!   version the action cannot install. The version input is now named and
//!   the documentation matches it.

use std::fs;

fn workflows() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/workflows.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("workflows.yml should exist")
    .replace("\r\n", "\n")
}

/// The zizmor version the action runs and the version documented for local
/// reproduction must be the same number, or a contributor reproducing a
/// finding locally is running a different analyser than CI did.
const ZIZMOR_VERSION: &str = "1.30.1";

#[test]
fn the_zizmor_version_is_named_instead_of_left_to_the_action_default() {
    let workflows = workflows();

    assert!(
        workflows.contains(&format!("version: {ZIZMOR_VERSION}")),
        "the zizmor step must pin version: {ZIZMOR_VERSION}; the action's `latest` \
         entry is a frozen table, not the newest zizmor (issue #166)"
    );
    assert!(
        !workflows.contains("zizmor==1.30.0"),
        "the documented reproduction command must match the version the action \
         actually runs; 1.30.0 was never installable through this action"
    );
}

#[test]
fn the_pedantic_pass_enforces_the_hash_pin_policy_on_images() {
    let workflows = workflows();

    let pedantic = workflows
        .split("- name: Audit for pedantic-only high-severity findings")
        .nth(1)
        .expect(
            "the zizmor job must run a narrow pedantic pass: the unpinned-images \
             audit does not exist in the regular persona, so the '*': hash-pin \
             policy is unenforced for `uses: docker://` references without it",
        );

    for required in [
        &format!("pipx run zizmor=={ZIZMOR_VERSION}"),
        "--persona pedantic",
        "--min-severity high",
        "--min-confidence high",
    ] {
        assert!(
            pedantic.contains(required),
            "the pedantic pass is missing {required:?}"
        );
    }
}

#[test]
fn container_image_uses_are_digest_pinned() {
    let workflows = workflows();

    for line in workflows
        .lines()
        .filter(|line| line.trim_start().starts_with("uses: docker://"))
    {
        assert!(
            line.contains("@sha256:"),
            "`uses: docker://` references must be digest-pinned; the regular \
             zizmor persona cannot see this class of mutable ref, so the pin is \
             the enforcement:\n{line}"
        );
    }
}
