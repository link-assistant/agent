//! Tests for filesystem utilities.
//!
//! Extracted from the original inline tests in rust/src/util/filesystem.rs.

use link_assistant_agent::util::filesystem::Filesystem;

#[test]
fn test_relative_path() {
    let rel = Filesystem::relative("/home/user", "/home/user/docs/file.txt");
    assert_eq!(rel.to_string_lossy(), "docs/file.txt");
}

#[tokio::test]
async fn test_find_up() {
    // Create a temp directory structure for testing
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path();

    // Create nested directories
    let nested = base.join("a").join("b").join("c");
    tokio::fs::create_dir_all(&nested).await.unwrap();

    // Create target files at different levels
    tokio::fs::write(base.join("target.txt"), "root")
        .await
        .unwrap();
    tokio::fs::write(base.join("a").join("target.txt"), "a")
        .await
        .unwrap();

    // Find from deepest level
    let found = Filesystem::find_up("target.txt", &nested, None).await;

    // Should find files at a/ and root
    assert_eq!(found.len(), 2);
}

// --- Additional tests ---

#[test]
fn test_relative_path_same_directory() {
    let rel = Filesystem::relative("/home/user", "/home/user");
    // Same directory returns "." (current directory indicator)
    assert_eq!(rel.to_string_lossy(), ".");
}

#[test]
fn test_relative_path_outside() {
    let rel = Filesystem::relative("/home/user", "/etc/config");
    // Should return the absolute path when outside base
    assert!(!rel.to_string_lossy().is_empty());
}

/// Paths that do not exist use the fallback, which must compare whole
/// components: `/a/bc` is not inside `/a/b`.
#[test]
fn test_contains_fallback_compares_components() {
    let base = "/nonexistent-issue-335/a/b";
    assert!(!Filesystem::contains(base, "/nonexistent-issue-335/a/bc"));
    assert!(!Filesystem::contains(
        base,
        "/nonexistent-issue-335/a/bc/d.txt"
    ));
    assert!(Filesystem::contains(
        base,
        "/nonexistent-issue-335/a/b/c.txt"
    ));
    assert!(Filesystem::contains(base, base));
}

#[test]
fn test_contains_existing_paths() {
    let temp = tempfile::tempdir().unwrap();
    let inner = temp.path().join("b");
    let sibling = temp.path().join("bc");
    std::fs::create_dir(&inner).unwrap();
    std::fs::create_dir(&sibling).unwrap();
    assert!(Filesystem::contains(temp.path(), &inner));
    assert!(!Filesystem::contains(&inner, &sibling));
}
