//! Regression test for issue #94: the release tag must be created only after
//! the push-retry loop succeeds, otherwise a `pull --rebase` retry rewrites the
//! release commit and leaves the tag on an orphaned commit.

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
fn tag_is_created_after_the_push_retry_loop() {
    let source = script();

    let rebase = source
        .find(r#"&["pull", "--rebase", "origin", &current_branch]"#)
        .expect("push-retry rebase not found");
    let tag = source
        .find(r#"&["tag", "-a", &tag_name, "-m", &tag_msg]"#)
        .expect("tag creation not found");
    // Issue #162: exactly the release tag is pushed -- `push --tags` would
    // publish unrelated local tags too.
    let push_tags = source
        .find(r#"&["push", "origin", &tag_name]"#)
        .expect("tag push not found");

    assert!(
        rebase < tag,
        "tag must be created after the push-retry rebase, not before"
    );
    assert!(tag < push_tags, "tag must be created before it is pushed");
    assert!(
        !source.contains(r#"&["push", "--tags"]"#),
        "the tag push must name the release tag, not every local tag"
    );
}
