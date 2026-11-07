//! Regression tests for issue #141.
//!
//! The multi-architecture manifest step built its digest list with a
//! single-quoted `printf` format, so `${DOCKERHUB_IMAGE}` was passed through
//! literally and `docker buildx imagetools create` received an invalid image
//! reference. `shellcheck` reports it as SC2016, but no workflow ran
//! `actionlint`, so the defect was never surfaced.

use std::fs;

fn workflow(name: &str) -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap_or_else(|error| panic!("{name} should exist: {error}"))
    .replace("\r\n", "\n")
}

/// The digest list must expand `DOCKERHUB_IMAGE`, so the `printf` format has to
/// be double quoted.
#[test]
fn manifest_digest_list_expands_dockerhub_image() {
    let release = workflow("release.yml");

    assert!(
        release.contains(r#"printf "${DOCKERHUB_IMAGE}@sha256:%s\n" *"#),
        "release.yml must build the digest list with a double-quoted printf format"
    );
    assert!(
        !release.contains(r"printf '${DOCKERHUB_IMAGE}@sha256:%s\n' *"),
        "release.yml still uses the single-quoted printf format (shellcheck SC2016)"
    );
}

/// A dedicated workflow keeps `actionlint` (and the `shellcheck` it bundles)
/// running on every change under `.github/`.
#[test]
fn workflows_are_linted_by_actionlint() {
    let workflows = workflow("workflows.yml");

    assert!(
        workflows.contains("uses: docker://rhysd/actionlint@"),
        "workflows.yml must run actionlint from its Docker image, which bundles shellcheck; \
         a native binary without shellcheck on PATH silently skips the shell checks"
    );
    assert!(
        workflows.contains("paths: ['.github/**',"),
        "the actionlint check must run for changes under .github/"
    );
}

/// `macos-15-intel` and `windows-11-arm` are real hosted runners. actionlint
/// 1.7.7 did not know them, which is why a `.github/actionlint.yaml` allowlist
/// used to suppress the false positives; 1.7.12 knows both labels, so the
/// suppression is gone and the pin must never silently fall back to a version
/// that would need it again (issue #160).
#[test]
fn actionlint_is_pinned_to_a_version_that_knows_the_runner_labels() {
    let workflows = workflow("workflows.yml");

    assert!(
        workflows.contains("rhysd/actionlint@sha256:"),
        "the actionlint image must be pinned by digest (issue #165: the unpinned-images \
         audit only runs in the pedantic persona, and a mutable tag is arbitrary code \
         execution in a job that holds credentials)"
    );
    assert!(
        workflows.contains("# v1.7.12"),
        "the digest pin must carry a human-readable version comment"
    );
    assert!(
        !std::path::Path::new(&format!(
            "{}/.github/actionlint.yaml",
            env!("CARGO_MANIFEST_DIR")
        ))
        .exists(),
        "the runner-label allowlist must stay deleted: its labels are known to \
         actionlint 1.7.12, and a stale suppression file hides real unknown-label \
         reports from future bumps"
    );

    let desktop = workflow("desktop-release.yml");
    assert!(
        desktop.contains("macos-15-intel") && desktop.contains("windows-11-arm"),
        "this regression test is keyed on desktop-release.yml using the labels that \
         needed the allowlist; if they disappear from the workflow, revisit the pin"
    );
}
