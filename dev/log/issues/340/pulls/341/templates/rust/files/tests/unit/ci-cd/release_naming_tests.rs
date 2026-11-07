use super::release_naming::{
    build_crates_io_badge, build_docs_rs_badge, build_release_name, build_release_tag,
    is_multi_language_rust_root, normalize_release_version, tag_prefix_for_rust_root,
};

#[test]
fn rust_root_controls_default_tag_prefix() {
    assert!(!is_multi_language_rust_root("."));
    assert_eq!(tag_prefix_for_rust_root("."), "v");

    assert!(is_multi_language_rust_root("rust"));
    assert_eq!(tag_prefix_for_rust_root("rust"), "rust_v");
}

#[test]
fn release_tags_are_idempotent_for_plain_and_prefixed_versions() {
    for version in ["1.2.3", "v1.2.3", "rust-v1.2.3", "rust_v1.2.3"] {
        assert_eq!(build_release_tag("rust_v", version), "rust_v1.2.3");
    }

    assert_eq!(build_release_tag("v", "rust_v1.2.3"), "v1.2.3");
}

#[test]
fn release_titles_follow_repository_layout() {
    assert_eq!(
        build_release_name("example-crate", "Rust", "rust_v1.2.3", false, None),
        "example-crate 1.2.3"
    );
    assert_eq!(
        build_release_name("example-crate", "Rust", "rust_v1.2.3", true, None),
        "[Rust] 1.2.3"
    );
}

#[test]
fn release_titles_keep_optional_label() {
    assert_eq!(
        build_release_name("example-crate", "Rust", "1.2.3", false, Some("stable")),
        "example-crate 1.2.3 (stable)"
    );
    assert_eq!(
        build_release_name("example-crate", "Rust", "1.2.3", true, Some("stable")),
        "[Rust] 1.2.3 (stable)"
    );
}

#[test]
fn version_normalization_strips_language_prefixes() {
    assert_eq!(normalize_release_version("v1.2.3"), "1.2.3");
    assert_eq!(normalize_release_version("rust_v1.2.3"), "1.2.3");
    assert_eq!(normalize_release_version("rust-v1.2.3"), "1.2.3");
    assert_eq!(normalize_release_version("js_v1.2.3"), "1.2.3");
}

#[test]
fn crates_io_badge_links_to_exact_bare_version_page() {
    let badge = build_crates_io_badge("example-crate", "rust_v1.2.3");

    assert!(badge.contains("img.shields.io/badge/crates.io-v1.2.3-orange?logo=rust"));
    assert!(badge.contains("https://crates.io/crates/example-crate/1.2.3"));
    assert!(!badge.contains("rust_v1.2.3"));
}

#[test]
fn docs_rs_badge_links_to_exact_bare_version_page_without_live_status() {
    let badge = build_docs_rs_badge("example-crate", "rust_v1.2.3");

    assert!(badge.contains("img.shields.io/badge/docs.rs-1.2.3-blue"));
    assert!(badge.contains("https://docs.rs/example-crate/1.2.3"));
    assert!(!badge.contains("docs.rs/example-crate/badge.svg"));
    assert!(!badge.contains("rust_v1.2.3"));
}
