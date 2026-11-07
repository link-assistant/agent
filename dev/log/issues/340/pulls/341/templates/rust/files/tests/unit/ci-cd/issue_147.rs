//! Regression tests for issue #147.
//!
//! `workflows.yml` ran `actionlint` but not `zizmor`, so workflow *security*
//! defects that `actionlint` cannot see shipped with the template: ten
//! `dtolnay/rust-toolchain@stable` references (a mutable branch of a
//! third-party repository, executed in jobs that hold `contents: write` and
//! publishing credentials), checkouts that persist `GITHUB_TOKEN` in
//! `.git/config`, and context expansions interpolated straight into `run:`
//! blocks.

use std::fs;

fn read(path: &str) -> String {
    fs::read_to_string(format!("{}/{path}", env!("CARGO_MANIFEST_DIR")))
        .unwrap_or_else(|error| panic!("{path} should exist: {error}"))
        .replace("\r\n", "\n")
}

fn workflow(name: &str) -> String {
    read(&format!(".github/workflows/{name}"))
}

fn all_workflows() -> Vec<(String, String)> {
    let dir = format!("{}/.github/workflows", env!("CARGO_MANIFEST_DIR"));
    let mut workflows: Vec<(String, String)> = fs::read_dir(&dir)
        .expect("the workflows directory should exist")
        .map(|entry| {
            entry
                .expect("workflow directory entry should be readable")
                .path()
        })
        .filter(|path| path.extension().is_some_and(|extension| extension == "yml"))
        .map(|path| {
            let name = path
                .file_name()
                .expect("workflow file should have a name")
                .to_string_lossy()
                .into_owned();
            (
                name,
                fs::read_to_string(&path)
                    .expect("workflow should be readable")
                    .replace("\r\n", "\n"),
            )
        })
        .collect();
    workflows.sort_by(|left, right| left.0.cmp(&right.0));
    assert!(!workflows.is_empty(), "there should be workflows to audit");
    workflows
}

/// The gate itself: `actionlint` alone passes on all of the defects below.
#[test]
fn workflows_are_audited_by_zizmor() {
    let workflows = workflow("workflows.yml");

    assert!(
        workflows.contains("uses: zizmorcore/zizmor-action@"),
        "workflows.yml must run zizmor; actionlint cannot see workflow security defects"
    );
    assert!(
        workflows.contains("config: .github/zizmor.yml"),
        "the zizmor job must use the repository's audit configuration"
    );
    assert!(
        workflows.contains("min-confidence: low"),
        "the zizmor job must report low-confidence findings, not only high ones"
    );
}

/// Without the configuration the blanket `hash-pin` policy is not applied and
/// `unpinned-uses` never fails on a mutable third-party ref.
#[test]
fn zizmor_configuration_requires_hash_pins_by_default() {
    let config = read(".github/zizmor.yml");

    assert!(
        config.contains("unpinned-uses:"),
        ".github/zizmor.yml must configure the unpinned-uses audit"
    );
    assert!(
        config.contains("'*': hash-pin"),
        ".github/zizmor.yml must require hash pins for actions outside the trusted namespaces"
    );
}

/// `stable` is a branch anyone able to move it can use for arbitrary code
/// execution in the release jobs.
#[test]
fn rust_toolchain_is_hash_pinned_everywhere() {
    for (name, body) in all_workflows() {
        assert!(
            !body.contains("dtolnay/rust-toolchain@stable"),
            "{name} pins dtolnay/rust-toolchain to the mutable `stable` branch"
        );
    }
}

/// Generated toolchain branches are force-updated. Their old commits can fall
/// out of upstream history despite being valid full-length hashes.
#[test]
fn rust_toolchain_pin_uses_verified_master_history() {
    // Verified against upstream master on 2026-10-26. Recheck ancestry when
    // updating: gh api repos/dtolnay/rust-toolchain/compare/<sha>...master
    const VERIFIED_MASTER_COMMIT: &str = "e2a55d2ffb04f378e9626c28d38b36d230d1e12f";
    for (name, body) in all_workflows() {
        for line in body.lines().filter(|line| {
            line.trim_start()
                .starts_with("uses: dtolnay/rust-toolchain@")
                || line
                    .trim_start()
                    .starts_with("- uses: dtolnay/rust-toolchain@")
        }) {
            assert!(
                line.contains(VERIFIED_MASTER_COMMIT),
                "{name} must pin a verified master-history commit, not a generated toolchain branch: {line}"
            );
        }
    }
}

/// Pinning to a hash drops the `stable` ref that used to supply the action's
/// default `toolchain:` input, so every pinned use has to restate it.
#[test]
fn hash_pinned_rust_toolchain_restates_the_toolchain_input() {
    for (name, body) in all_workflows() {
        for (index, _) in body.match_indices("uses: dtolnay/rust-toolchain@") {
            let tail = &body[index..];
            let block: String = tail.lines().take(8).collect::<Vec<_>>().join("\n");
            assert!(
                block.contains("toolchain: stable"),
                "{name} uses a hash-pinned dtolnay/rust-toolchain without restating `toolchain: stable`; \
                 the action would otherwise install the wrong toolchain"
            );
        }
    }
}

/// Only the jobs that push the version bump commit and tag may keep the
/// checkout credentials in `.git/config`.
#[test]
fn read_only_checkouts_do_not_persist_credentials() {
    for (name, body) in all_workflows() {
        for (index, _) in body.match_indices("uses: actions/checkout@") {
            let tail = &body[index..];
            let block: String = tail.lines().take(6).collect::<Vec<_>>().join("\n");
            assert!(
                block.contains("persist-credentials: false")
                    || block.contains("token: ${{ secrets.GITHUB_TOKEN }}"),
                "{name} has a checkout that persists GITHUB_TOKEN in .git/config without needing \
                 write access; add `persist-credentials: false`:\n{block}"
            );
        }
    }
}

/// Contexts belong in `env:`, never interpolated into the shell source.
#[test]
fn run_blocks_do_not_interpolate_the_github_context() {
    for (name, body) in all_workflows() {
        let mut run_indent: Option<usize> = None;
        for (number, line) in body.lines().enumerate() {
            let indent = line.len() - line.trim_start().len();
            let trimmed = line.trim_start();
            let in_block = match run_indent {
                Some(base) if trimmed.is_empty() || indent > base => true,
                Some(_) => {
                    run_indent = None;
                    false
                }
                None => false,
            };
            let starts_block = trimmed.starts_with("run: ") || trimmed == "run: |";
            if starts_block {
                run_indent = Some(indent);
            }
            if !in_block && !starts_block {
                continue;
            }
            for context in [
                "${{ github.repository }}",
                "${{ github.run_id }}",
                "${{ github.server_url }}",
                "${{ github.head_ref }}",
                "${{ github.event.",
                "${{ matrix.",
                "${{ steps.",
            ] {
                assert!(
                    !line.contains(context),
                    "{name}:{} interpolates {context} into a run block; pass it through `env:` instead",
                    number + 1
                );
            }
        }
    }
}
