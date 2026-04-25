//! Rust counterpart of `js/tests/storage-migration.ts`.
//!
//! The JS test exercises a storage migration helper that moves session
//! files between layout versions. The Rust port does not yet persist
//! sessions to disk in the same layout, so the JS-only paths cannot be
//! mirrored directly.
//!
//! When the Rust port grows a session storage module, this file should
//! mirror the JS test cases (path safety, atomic writes, version
//! detection). For now we verify the related Rust filesystem helpers
//! that the storage layer would build on.

use link_assistant_agent::util::Filesystem;

#[test]
fn parent_contains_child_path() {
    assert!(Filesystem::contains("/tmp", "/tmp/sessions"));
}

#[test]
fn unrelated_paths_do_not_overlap() {
    assert!(!Filesystem::overlaps("/tmp/sessions", "/var/data"));
}

#[test]
fn overlapping_paths_are_detected_in_either_order() {
    assert!(Filesystem::overlaps("/tmp", "/tmp/sessions"));
    assert!(Filesystem::overlaps("/tmp/sessions", "/tmp"));
}
