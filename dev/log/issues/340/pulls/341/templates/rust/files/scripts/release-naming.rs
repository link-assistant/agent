#![allow(dead_code)]

use regex::Regex;

const DEFAULT_LANGUAGE: &str = "Rust";
const SINGLE_LANGUAGE_TAG_PREFIX: &str = "v";
const RUST_MULTI_LANGUAGE_TAG_PREFIX: &str = "rust_v";

fn is_root_rust_root(rust_root: &str) -> bool {
    matches!(rust_root.trim(), "" | "." | "./")
}

pub fn is_multi_language_rust_root(rust_root: &str) -> bool {
    !is_root_rust_root(rust_root)
}

pub fn tag_prefix_for_rust_root(rust_root: &str) -> &'static str {
    if is_multi_language_rust_root(rust_root) {
        RUST_MULTI_LANGUAGE_TAG_PREFIX
    } else {
        SINGLE_LANGUAGE_TAG_PREFIX
    }
}

pub fn normalize_release_version(release_version: &str) -> String {
    let trimmed = release_version.trim();
    let semver_re =
        Regex::new(r"(?i)(?:^|[-_])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$")
            .expect("release version regex should compile");

    semver_re.captures(trimmed).map_or_else(
        || {
            trimmed
                .strip_prefix('v')
                .or_else(|| trimmed.strip_prefix('V'))
                .unwrap_or(trimmed)
                .to_string()
        },
        |captures| {
            captures
                .get(1)
                .expect("release version regex should capture the semver")
                .as_str()
                .to_string()
        },
    )
}

pub fn build_release_tag(tag_prefix: &str, release_version: &str) -> String {
    let normalized_semver = normalize_release_version(release_version);
    let prefix = tag_prefix.trim();
    let prefix = if prefix.is_empty() {
        SINGLE_LANGUAGE_TAG_PREFIX
    } else {
        prefix
    };

    format!("{prefix}{normalized_semver}")
}

pub fn build_release_name(
    crate_name: &str,
    language: &str,
    release_version: &str,
    multi_language: bool,
    release_label: Option<&str>,
) -> String {
    let normalized_semver = normalize_release_version(release_version);
    let base_name = if multi_language {
        let language = normalized_language(language);
        format!("[{language}] {normalized_semver}")
    } else {
        let crate_name = normalized_single_language_name(crate_name, language);
        format!("{crate_name} {normalized_semver}")
    };

    match release_label
        .map(str::trim)
        .filter(|label| !label.is_empty())
    {
        Some(label) => format!("{base_name} ({label})"),
        None => base_name,
    }
}

fn normalized_language(language: &str) -> String {
    let language = language.trim();
    if language.is_empty() {
        DEFAULT_LANGUAGE.to_string()
    } else {
        language.to_string()
    }
}

fn normalized_single_language_name(crate_name: &str, language: &str) -> String {
    let crate_name = crate_name.trim();
    if crate_name.is_empty() {
        normalized_language(language)
    } else {
        crate_name.to_string()
    }
}

fn badge_escape(value: &str) -> String {
    value
        .replace('-', "--")
        .replace('_', "__")
        .replace(' ', "%20")
        .replace('/', "%2F")
        .replace(':', "%3A")
        .replace('+', "%2B")
}

pub fn build_crates_io_badge(crate_name: &str, release_version: &str) -> String {
    let crate_name = crate_name.trim();
    let normalized_semver = normalize_release_version(release_version);
    let badge_version = format!("v{normalized_semver}");

    format!(
        "[![crates.io](https://img.shields.io/badge/crates.io-{}-orange?logo=rust)](https://crates.io/crates/{crate_name}/{normalized_semver})",
        badge_escape(&badge_version)
    )
}

pub fn build_docs_rs_badge(crate_name: &str, release_version: &str) -> String {
    let crate_name = crate_name.trim();
    let normalized_semver = normalize_release_version(release_version);

    format!(
        "[![Docs.rs](https://img.shields.io/badge/docs.rs-{}-blue)](https://docs.rs/{crate_name}/{normalized_semver})",
        badge_escape(&normalized_semver)
    )
}
