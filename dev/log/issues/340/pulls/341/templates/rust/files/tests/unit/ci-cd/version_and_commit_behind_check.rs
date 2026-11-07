//! Regression test for issue #95: the pre-bump sync must only rebase when the
//! branch is actually behind `origin/<branch>`, and must not claim "behind"
//! merely because the local and remote SHAs differ (being ahead differs too).

use std::fs;

fn script() -> String {
    fs::read_to_string(format!(
        "{}/scripts/version-and-commit.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    .replace("\r\n", "\n")
}

#[test]
fn behind_is_measured_not_inferred_from_sha_inequality() {
    let source = script();

    assert!(
        source.contains(r#"format!("HEAD..origin/{}", current_branch)"#),
        "the behind-count must be computed with rev-list HEAD..origin/<branch>"
    );
    assert!(
        source.contains("if behind > 0 {"),
        "rebase must only run when the branch is actually behind"
    );
    assert!(
        !source.contains("Local branch is behind remote, rebasing..."),
        "the message must report the real behind count, not a bare SHA mismatch"
    );
}
