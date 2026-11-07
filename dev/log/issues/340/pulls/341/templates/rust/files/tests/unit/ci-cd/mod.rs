mod changelog_parsing;
#[path = "../../../scripts/check-cargo-lock.rs"]
mod check_cargo_lock;
#[path = "../../../scripts/check-crate-size.rs"]
mod check_crate_size;
#[path = "../../../scripts/check-file-size.rs"]
mod check_file_size;
// create-github-release.rs declares its own `release_naming` module, because
// `rust-script --test` builds it as a standalone crate root with no sibling to
// borrow (issue #150). Loading release-naming.rs twice here is the price of
// that; the sibling `mod release_naming` below is what release_naming_tests.rs
// exercises directly.
#[allow(clippy::all, clippy::nursery, clippy::pedantic, dead_code)]
#[path = "../../../scripts/check-workflow-tools.rs"]
mod check_workflow_tools;
#[allow(clippy::duplicate_mod)]
#[path = "../../../scripts/create-github-release.rs"]
mod create_github_release;
mod desktop_release_resolve;
#[allow(clippy::all, clippy::nursery, clippy::pedantic, dead_code)]
#[path = "../../../scripts/detect-code-changes.rs"]
mod detect_code_changes;
mod issue_119;
mod issue_127;
mod issue_135;
mod issue_141;
mod issue_143;
mod issue_147;
mod issue_149;
mod issue_150;
mod issue_156;
mod issue_157;
mod issue_160;
mod issue_161;
mod issue_163;
mod issue_168;
mod issue_171;
mod issue_172;
mod issue_188;
mod issue_193;
#[path = "../../../scripts/release-naming.rs"]
mod release_naming;
mod release_naming_tests;
#[path = "../../../scripts/rust-paths.rs"]
mod rust_paths;
#[allow(clippy::all, clippy::nursery, clippy::pedantic, dead_code)]
#[path = "../../../scripts/smoke-test-published-crate.rs"]
mod smoke_test_published_crate;
#[allow(clippy::all, clippy::nursery, clippy::pedantic, dead_code)]
#[path = "../../../scripts/version-and-commit.rs"]
mod version_and_commit;
mod version_and_commit_behind_check;
mod version_and_commit_tag_order;
#[allow(
    clippy::all,
    clippy::nursery,
    clippy::pedantic,
    dead_code,
    unused_imports
)]
#[path = "../../../scripts/wait-for-crate.rs"]
mod wait_for_crate;
mod workflow_desktop_release;
mod workflow_release;
mod workflow_release_gates;
mod workflow_security;
mod workspace_manifest_resolution;
