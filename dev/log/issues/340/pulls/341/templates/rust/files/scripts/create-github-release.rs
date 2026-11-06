#!/usr/bin/env rust-script
//! Create GitHub Release from CHANGELOG.md
//!
//! Automatically includes crates.io and docs.rs badges in release notes
//! when the crate name can be detected from Cargo.toml.
//!
//! Usage: rust-script scripts/create-github-release.rs --release-version <version> --repository <repository> [--tag-prefix <prefix>] [--language <name>] [--release-label <label>] [--docker-hub-url <url>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! serde = { version = "1", features = ["derive"] }
//! serde_json = "1"
//! ```

#[cfg(not(test))]
use serde::Serialize;
#[cfg(not(test))]
use std::env;
#[cfg(not(test))]
use std::fs;
#[cfg(not(test))]
use std::io::Write;
#[cfg(not(test))]
use std::process::{exit, Command, Stdio};

// Declared unconditionally: `rust-script --test` builds this file as its own
// crate root, where a `super::` re-import would resolve to nothing. See #150.
#[path = "release-naming.rs"]
mod release_naming;
#[cfg(not(test))]
#[path = "rust-paths.rs"]
mod rust_paths;

#[cfg(not(test))]
const USAGE: &str = "Usage: rust-script scripts/create-github-release.rs --release-version <version> --repository <repository> [--tag-prefix <prefix>] [--language <name>] [--release-label <label>] [--docker-hub-url <url>]";

const GITHUB_RELEASE_BODY_MAX_CHARS: usize = 125_000;

use release_naming::{
    build_crates_io_badge, build_docs_rs_badge, build_release_name, build_release_tag,
};
#[cfg(not(test))]
use release_naming::{
    is_multi_language_rust_root, normalize_release_version, tag_prefix_for_rust_root,
};

#[cfg(not(test))]
fn get_changelog_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./CHANGELOG.md".to_string()
    } else {
        format!("{rust_root}/CHANGELOG.md")
    }
}

#[cfg(not(test))]
fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{name}");

    if let Some(idx) = args.iter().position(|arg| arg == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|value| !value.is_empty())
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

fn docker_hub_tag_query(version: &str) -> String {
    version.replace('+', "%2B")
}

fn docker_hub_badge(url: &str, version: &str) -> String {
    let trimmed_url = url.trim_end_matches('/');
    let image = trimmed_url
        .strip_prefix("https://hub.docker.com/r/")
        .unwrap_or(trimmed_url);
    let image_tag = format!("{image}:{version}");
    let tag_url = format!(
        "{}/tags?name={}",
        trimmed_url,
        docker_hub_tag_query(version)
    );

    format!(
        "[![Docker Hub](https://img.shields.io/badge/docker-{}-2496ED?logo=docker)]({})",
        badge_escape(&image_tag),
        tag_url
    )
}

#[path = "release-content.rs"]
mod release_content;

#[cfg(not(test))]
fn get_changelog_for_version(changelog_path: &str, version: &str) -> Result<String, String> {
    let content = fs::read_to_string(changelog_path)
        .map_err(|error| format!("Cannot read required changelog {changelog_path}: {error}"))?;
    release_content::release_notes(&content, version)
}

#[cfg_attr(not(test), derive(Serialize))]
#[derive(Debug, PartialEq, Eq)]
struct ReleasePayload {
    tag_name: String,
    name: String,
    body: String,
}

fn build_release_payload(
    tag_prefix: &str,
    release_version: &str,
    crate_name: &str,
    language: &str,
    multi_language: bool,
    release_label: Option<&str>,
    body: String,
) -> ReleasePayload {
    ReleasePayload {
        tag_name: build_release_tag(tag_prefix, release_version),
        name: build_release_name(
            crate_name,
            language,
            release_version,
            multi_language,
            release_label,
        ),
        body,
    }
}

fn build_crate_artifact_badges(crate_name: &str, release_version: &str) -> String {
    format!(
        "{} {}",
        build_crates_io_badge(crate_name, release_version),
        build_docs_rs_badge(crate_name, release_version)
    )
}

fn is_existing_release_error(combined: &str) -> bool {
    let Some(error) = parse_first_json_object(combined) else {
        return false;
    };
    let Some(errors) = error.get("errors").and_then(serde_json::Value::as_array) else {
        return false;
    };

    !errors.is_empty()
        && errors.iter().all(|error| {
            error.get("resource").and_then(serde_json::Value::as_str) == Some("Release")
                && error.get("code").and_then(serde_json::Value::as_str) == Some("already_exists")
                && error.get("field").and_then(serde_json::Value::as_str) == Some("tag_name")
        })
}

fn parse_first_json_object(output: &str) -> Option<serde_json::Value> {
    output.match_indices('{').find_map(|(start, _)| {
        let mut values =
            serde_json::Deserializer::from_str(&output[start..]).into_iter::<serde_json::Value>();
        let value = values.next()?.ok()?;

        matches!(value, serde_json::Value::Object(_)).then_some(value)
    })
}

fn normalize_changelog_blob_path(changelog_path: &str) -> String {
    changelog_path
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

fn full_changelog_url(repository: &str, tag: &str, changelog_path: &str) -> String {
    format!(
        "https://github.com/{repository}/blob/{tag}/{}",
        normalize_changelog_blob_path(changelog_path)
    )
}

fn cap_release_notes(
    release_notes: String,
    repository: &str,
    tag: &str,
    changelog_path: &str,
) -> String {
    if release_notes.chars().count() <= GITHUB_RELEASE_BODY_MAX_CHARS {
        return release_notes;
    }

    let footer = format!(
        "\n\nRelease notes truncated. See the [full changelog]({}).",
        full_changelog_url(repository, tag, changelog_path)
    );
    let marker = "\n\n...";
    let reserved_chars = footer.chars().count() + marker.chars().count();

    if reserved_chars >= GITHUB_RELEASE_BODY_MAX_CHARS {
        return release_notes
            .chars()
            .take(GITHUB_RELEASE_BODY_MAX_CHARS)
            .collect();
    }

    let keep_chars = GITHUB_RELEASE_BODY_MAX_CHARS - reserved_chars;
    let mut truncated = release_notes.chars().take(keep_chars).collect::<String>();
    let trimmed_len = truncated.trim_end().len();
    truncated.truncate(trimmed_len);

    format!("{truncated}{marker}{footer}")
}

#[cfg(not(test))]
fn main() {
    let version = match get_arg("release-version") {
        Some(version) => version,
        None => {
            eprintln!("Error: Missing required argument --release-version");
            eprintln!("{USAGE}");
            exit(1);
        }
    };

    let repository = match get_arg("repository") {
        Some(repository) => repository,
        None => {
            eprintln!("Error: Missing required argument --repository");
            eprintln!("{USAGE}");
            exit(1);
        }
    };

    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };
    let package_info = match rust_paths::read_package_info(&package_manifest) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };
    let tag_prefix =
        get_arg("tag-prefix").unwrap_or_else(|| tag_prefix_for_rust_root(&rust_root).to_string());
    let language = get_arg("language").unwrap_or_else(|| "Rust".to_string());
    let release_label = get_arg("release-label");
    let crates_io_url = get_arg("crates-io-url");
    let docker_hub_url = get_arg("docker-hub-url");
    let normalized_version = normalize_release_version(&version);
    let multi_language = is_multi_language_rust_root(&rust_root);

    if package_info.name == "example-sum-package-name" {
        println!(
            "Skipping GitHub release: package name is the template default 'example-sum-package-name'"
        );
        println!("Rename the package in Cargo.toml before creating releases");
        return;
    }

    let changelog_path = get_changelog_path(&rust_root);
    let mut release_notes = get_changelog_for_version(&changelog_path, &normalized_version)
        .unwrap_or_else(|error| {
            eprintln!("::error::{error}");
            exit(1);
        });
    let mut badges = Vec::new();
    if !package_info.name.trim().is_empty() {
        let crate_name = &package_info.name;
        badges.push(build_crate_artifact_badges(crate_name, &normalized_version));
    }
    if let Some(url) = docker_hub_url {
        badges.push(docker_hub_badge(&url, &normalized_version));
    }
    if !badges.is_empty() {
        release_notes = format!("{}\n\n{release_notes}", badges.join(" "));
    }

    if let Some(url) = crates_io_url {
        release_notes = format!("{url}\n\n{release_notes}");
    }

    let release_tag = build_release_tag(&tag_prefix, &normalized_version);
    release_notes = cap_release_notes(release_notes, &repository, &release_tag, &changelog_path);

    let payload = build_release_payload(
        &tag_prefix,
        &normalized_version,
        &package_info.name,
        &language,
        multi_language,
        release_label.as_deref(),
        release_notes,
    );
    let tag = payload.tag_name.clone();
    println!("Creating GitHub release for {} ({})...", tag, payload.name);

    let payload_json = serde_json::to_string(&payload).expect("Failed to serialize payload");

    let mut child = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repository}/releases"),
            "-X",
            "POST",
            "--input",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to execute gh command");

    if let Some(ref mut stdin) = child.stdin {
        stdin
            .write_all(payload_json.as_bytes())
            .expect("Failed to write to stdin");
    }

    let output = child
        .wait_with_output()
        .expect("Failed to wait on gh command");

    if output.status.success() {
        println!("Created GitHub release: {tag}");
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{stderr}{stdout}");
        if is_existing_release_error(&combined) {
            println!("Release {tag} already exists, skipping");
        } else {
            let details = combined.trim();
            if details.is_empty() {
                eprintln!("Error creating release: gh api exited unsuccessfully");
            } else {
                eprintln!("Error creating release:\n{details}");
            }
            exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_title_uses_layout_and_bare_semver() {
        assert_eq!(
            build_release_name("web-search", "Rust", "rust_v0.2.1", true, None),
            "[Rust] 0.2.1"
        );
        assert_eq!(
            build_release_name("web-search-js", "JavaScript", "js_v1.2.3", true, None),
            "[JavaScript] 1.2.3"
        );
        assert_eq!(
            build_release_name("web-search", "Rust", "rust_v0.2.1", false, None),
            "web-search 0.2.1"
        );
    }

    #[test]
    fn release_title_defaults_empty_language_to_rust() {
        assert_eq!(
            build_release_name("web-search", " ", "0.2.1", true, None),
            "[Rust] 0.2.1"
        );
    }

    #[test]
    fn release_label_remains_optional_suffix() {
        assert_eq!(
            build_release_name("web-search", "Rust", "0.2.1", true, Some("stable")),
            "[Rust] 0.2.1 (stable)"
        );
        assert_eq!(
            build_release_name("web-search", "Rust", "0.2.1", true, Some(" ")),
            "[Rust] 0.2.1"
        );
        assert_eq!(
            build_release_name("web-search", "Rust", "0.2.1", false, Some("stable")),
            "web-search 0.2.1 (stable)"
        );
    }

    #[test]
    fn release_tag_uses_prefix_with_normalized_semver() {
        assert_eq!(build_release_tag("rust-v", "0.2.1"), "rust-v0.2.1");
        assert_eq!(build_release_tag("rust_v", "rust-v0.2.1"), "rust_v0.2.1");
        assert_eq!(build_release_tag("rust_v", "rust_v0.2.1"), "rust_v0.2.1");
        assert_eq!(build_release_tag("v", "v0.2.1"), "v0.2.1");
    }

    #[test]
    fn crates_io_badge_links_to_bare_version_page() {
        let badge = build_crates_io_badge("web-search", "rust_v0.2.1");

        assert!(badge.contains("https://crates.io/crates/web-search/0.2.1"));
        assert!(!badge.contains("rust_v0.2.1"));
    }

    #[test]
    fn release_note_artifact_badges_use_static_docs_rs_version_badge() {
        let badges = build_crate_artifact_badges("web-search", "rust_v0.2.1");

        assert!(badges.contains("https://img.shields.io/badge/docs.rs-0.2.1-blue"));
        assert!(badges.contains("https://docs.rs/web-search/0.2.1"));
        assert!(!badges.contains("https://docs.rs/web-search/badge.svg"));
        assert!(!badges.contains("rust_v0.2.1"));
    }

    #[test]
    fn release_payload_keeps_tag_prefix_out_of_release_name() {
        let payload = build_release_payload(
            "rust_v",
            "0.2.1",
            "web-search",
            "Rust",
            true,
            None,
            "release notes".to_string(),
        );

        assert_eq!(
            payload,
            ReleasePayload {
                tag_name: "rust_v0.2.1".to_string(),
                name: "[Rust] 0.2.1".to_string(),
                body: "release notes".to_string(),
            }
        );
    }

    #[test]
    fn docker_hub_badge_links_to_exact_tag() {
        let badge = docker_hub_badge("https://hub.docker.com/r/example/project", "1.2.3");

        assert!(badge.contains("docker-example%2Fproject%3A1.2.3"));
        assert!(badge.contains("https://hub.docker.com/r/example/project/tags?name=1.2.3"));
    }

    #[test]
    fn docker_hub_badge_escapes_build_metadata() {
        let badge = docker_hub_badge("https://hub.docker.com/r/example/project", "1.2.3+build.4");

        assert!(badge.contains("1.2.3%2Bbuild.4"));
        assert!(badge.contains("tags?name=1.2.3%2Bbuild.4"));
    }

    #[test]
    fn duplicate_release_validation_is_idempotent() {
        let output = r#"gh: Validation Failed (HTTP 422)
{"message":"Validation Failed","errors":[{"resource":"Release","code":"already_exists","field":"tag_name"}]}"#;

        assert!(is_existing_release_error(output));
    }

    #[test]
    fn generic_validation_failure_is_not_existing_release() {
        let output = r#"gh: Validation Failed (HTTP 422)
{"message":"Validation Failed","errors":[{"resource":"Release","code":"custom","field":"body"}]}"#;

        assert!(!is_existing_release_error(output));
    }

    #[test]
    fn mixed_validation_failure_is_not_existing_release() {
        let output = r#"gh: Validation Failed (HTTP 422)
{"message":"Validation Failed","errors":[{"resource":"Release","code":"already_exists","field":"tag_name"},{"resource":"Release","code":"custom","field":"body"}]}"#;

        assert!(!is_existing_release_error(output));
    }

    #[test]
    fn oversized_release_notes_are_capped_with_full_changelog_link() {
        let release_notes = "a".repeat(GITHUB_RELEASE_BODY_MAX_CHARS + 100);
        let capped = cap_release_notes(release_notes, "owner/repo", "v1.2.3", "./CHANGELOG.md");

        assert!(capped.chars().count() <= GITHUB_RELEASE_BODY_MAX_CHARS);
        assert!(capped.contains("Release notes truncated"));
        assert!(capped.contains("https://github.com/owner/repo/blob/v1.2.3/CHANGELOG.md"));
    }
}
