#!/usr/bin/env rust-script
//! Wait for a crates.io package version to become visible.
//!
//! The Docker release step runs after `cargo publish`, but crates.io indexing can
//! lag briefly. Waiting here makes Docker Hub tags and GitHub releases point at a
//! crate version that users can already resolve.
//!
//! Visibility is probed against the sparse index (`https://index.crates.io`),
//! which is what `cargo` resolves dependencies against and which is not rate
//! limited, with the JSON API as a fallback. A probe that fails for a reason
//! other than "this version does not exist" (403, 429, 5xx, DNS, TLS) is
//! reported as *unknown*, never as "not published": a failed probe says nothing
//! about whether `cargo publish` succeeded. See issue #143.
//!
//! Usage:
//!   rust-script scripts/wait-for-crate.rs --release-version <version>
//!
//! Optional arguments:
//!   --crate-name <name>       Crate name. Defaults to Cargo.toml package name.
//!   --rust-root <path>        Root containing Cargo.toml. Defaults to auto-detect.
//!   --max-attempts <count>    Defaults to 40.
//!   --sleep-seconds <count>   Defaults to 15.
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - crate_available: 'true' when the version is visible, or 'skipped' for template defaults
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ureq = "2"
//! ```

// `rust-script --test` builds this file as a test harness, where `main` is not
// the entry point, so helpers and imports reachable only from `main` look
// unused. The real (non-test) build still denies both.
#![cfg_attr(test, allow(dead_code, unused_imports))]

use std::env;
use std::process::exit;
use std::thread;
use std::time::Duration;

#[path = "rust-paths.rs"]
mod rust_paths;

/// crates.io answers 403 to clients that do not identify themselves, and asks
/// that the contact address in the `User-Agent` be reachable.
const USER_AGENT: &str = "rust-script-wait-for-crate (+https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)";

/// What a crates.io probe actually established.
///
/// A bare `bool` cannot carry the difference between "crates.io said this
/// version does not exist" and "crates.io did not answer", which is why a
/// throttled probe used to be reported as a failed release.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Visibility {
    /// The version is resolvable by `cargo`.
    Published,
    /// crates.io answered, and the version is not there (yet).
    NotPublishedYet,
    /// crates.io could not be consulted; this says nothing about the release.
    Unknown(String),
}

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

#[cfg(not(test))]
#[path = "github-output.rs"]
mod github_output;

#[cfg(not(test))]
fn set_output(key: &str, value: &str) -> std::io::Result<()> {
    github_output::write_output(key, value)?;
    println!("Output: {key}={value}");
    Ok(())
}

fn parse_count_arg(name: &str, default: u64) -> u64 {
    get_arg(name)
        .and_then(|value| {
            value.parse::<u64>().map_or_else(
                |_| {
                    eprintln!(
                        "Warning: Invalid {} value '{}'; using default {}",
                        name, value, default
                    );
                    None
                },
                Some,
            )
        })
        .unwrap_or(default)
}

/// Sparse index path for a crate, following the `1/x`, `2/xy`, `3/x/xyz`,
/// `ab/cd/name` layout documented by the registry index specification.
fn index_path(crate_name: &str) -> String {
    let name = crate_name.to_lowercase();
    let chars: Vec<char> = name.chars().collect();

    match chars.len() {
        0 => name,
        1 => format!("1/{}", name),
        2 => format!("2/{}", name),
        3 => format!("3/{}/{}", chars[0], name),
        _ => format!("{}{}/{}{}/{}", chars[0], chars[1], chars[2], chars[3], name),
    }
}

fn index_url(crate_name: &str) -> String {
    format!("https://index.crates.io/{}", index_path(crate_name))
}

fn api_url(crate_name: &str, version: &str) -> String {
    format!("https://crates.io/api/v1/crates/{}/{}", crate_name, version)
}

/// The sparse index returns 200 for any existing crate, so the version has to be
/// matched inside the newline-delimited JSON body rather than inferred from the
/// status code.
fn index_body_has_version(body: &str, version: &str) -> bool {
    body.lines().any(|line| {
        line.split("\"vers\"").skip(1).any(|rest| {
            let rest = rest.trim_start();
            let Some(rest) = rest.strip_prefix(':') else {
                return false;
            };
            let rest = rest.trim_start();
            rest.strip_prefix('"')
                .and_then(|rest| rest.split('"').next())
                .is_some_and(|found| found == version)
        })
    })
}

/// Classify a sparse index response. A 404 there means the crate has never been
/// published under that name; any other non-200 is an unusable answer.
fn classify_index_response(status: u16, body: &str, version: &str) -> Visibility {
    match status {
        200 => {
            if index_body_has_version(body, version) {
                Visibility::Published
            } else {
                Visibility::NotPublishedYet
            }
        }
        404 => Visibility::NotPublishedYet,
        other => Visibility::Unknown(format!("index.crates.io responded HTTP {}", other)),
    }
}

/// Classify a JSON API response for a specific version.
fn classify_api_status(status: u16) -> Visibility {
    match status {
        200 => Visibility::Published,
        404 => Visibility::NotPublishedYet,
        other => Visibility::Unknown(format!("crates.io API responded HTTP {}", other)),
    }
}

/// Prefer a definitive answer from either source; only report `Unknown` when
/// neither source could be consulted.
fn combine(index: Visibility, api: Visibility) -> Visibility {
    match (index, api) {
        (Visibility::Published, _) | (_, Visibility::Published) => Visibility::Published,
        (Visibility::NotPublishedYet, _) | (_, Visibility::NotPublishedYet) => {
            Visibility::NotPublishedYet
        }
        (Visibility::Unknown(index_reason), Visibility::Unknown(api_reason)) => {
            Visibility::Unknown(format!("{}; {}", index_reason, api_reason))
        }
    }
}

/// The message printed when the wait runs out of attempts. `last_unknown` is
/// `Some(..)` when no attempt ever got a definitive answer, which means the
/// release status is unknown rather than broken.
fn failure_message(
    crate_name: &str,
    version: &str,
    max_attempts: u64,
    last_unknown: Option<&str>,
) -> String {
    match last_unknown {
        Some(reason) => format!(
            "Error: could not determine whether {}@{} is on crates.io; \
             all {} attempts failed to get an answer, the last one with: {}. \
             This does NOT mean the publish failed. Check the sparse index before \
             treating the release as broken: curl -s -A 'ci (+https://example.com)' {} | grep '\"vers\":\"{}\"'",
            crate_name, version, max_attempts, reason, index_url(crate_name), version
        ),
        None => format!(
            "Error: {}@{} was not visible on crates.io after {} attempts",
            crate_name, version, max_attempts
        ),
    }
}

#[cfg(not(test))]
fn check_index(crate_name: &str, version: &str) -> Visibility {
    match ureq::get(&index_url(crate_name))
        .set("User-Agent", USER_AGENT)
        .call()
    {
        Ok(response) => {
            let status = response.status();
            let body = response.into_string().unwrap_or_default();
            classify_index_response(status, &body, version)
        }
        Err(ureq::Error::Status(status, _)) => classify_index_response(status, "", version),
        Err(e) => Visibility::Unknown(format!("index.crates.io request failed: {}", e)),
    }
}

#[cfg(not(test))]
fn check_api(crate_name: &str, version: &str) -> Visibility {
    match ureq::get(&api_url(crate_name, version))
        .set("User-Agent", USER_AGENT)
        .call()
    {
        Ok(response) => classify_api_status(response.status()),
        Err(ureq::Error::Status(status, _)) => classify_api_status(status),
        Err(e) => Visibility::Unknown(format!("crates.io API request failed: {}", e)),
    }
}

#[cfg(not(test))]
fn crate_version_visibility(crate_name: &str, version: &str) -> Visibility {
    let index = check_index(crate_name, version);
    if index == Visibility::Published {
        return index;
    }
    combine(index, check_api(crate_name, version))
}

fn should_skip_crate_wait(crate_name: &str) -> bool {
    crate_name == "example-sum-package-name"
}

#[cfg(not(test))]
fn main() -> std::io::Result<()> {
    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let package_info = match rust_paths::read_package_info(&package_manifest) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    let crate_name = get_arg("crate-name").unwrap_or(package_info.name);
    let version = get_arg("release-version").unwrap_or(package_info.version);
    let max_attempts = parse_count_arg("max-attempts", 40);
    let sleep_seconds = parse_count_arg("sleep-seconds", 15);

    if should_skip_crate_wait(&crate_name) {
        println!(
            "Skipping crates.io availability wait: package name is the template default '{}'",
            crate_name
        );
        set_output("crate_available", "skipped")?;
        return Ok(());
    }

    let mut last_unknown: Option<String> = None;
    let mut saw_definitive_answer = false;

    for attempt in 1..=max_attempts {
        match crate_version_visibility(&crate_name, &version) {
            Visibility::Published => {
                println!(
                    "{}@{} is visible on crates.io after attempt {}",
                    crate_name, version, attempt
                );
                set_output("crate_available", "true")?;
                return Ok(());
            }
            Visibility::NotPublishedYet => {
                saw_definitive_answer = true;
                if attempt < max_attempts {
                    println!(
                        "{}@{} is not visible on crates.io yet (attempt {}/{}); waiting {}s",
                        crate_name, version, attempt, max_attempts, sleep_seconds
                    );
                }
            }
            Visibility::Unknown(reason) => {
                eprintln!(
                    "Warning: could not check crates.io on attempt {}/{}: {}",
                    attempt, max_attempts, reason
                );
                last_unknown = Some(reason);
                if attempt < max_attempts {
                    println!("Retrying in {}s", sleep_seconds);
                }
            }
        }

        if attempt < max_attempts {
            thread::sleep(Duration::from_secs(sleep_seconds));
        }
    }

    eprintln!(
        "{}",
        failure_message(
            &crate_name,
            &version,
            max_attempts,
            if saw_definitive_answer {
                None
            } else {
                last_unknown.as_deref()
            },
        )
    );
    exit(1);
}

#[cfg(test)]
mod tests {
    use super::{
        api_url, classify_api_status, classify_index_response, combine, failure_message,
        index_body_has_version, index_path, index_url, should_skip_crate_wait, Visibility,
        USER_AGENT,
    };

    #[test]
    fn skips_template_default_package_name() {
        assert!(should_skip_crate_wait("example-sum-package-name"));
    }

    #[test]
    fn waits_for_real_package_names() {
        assert!(!should_skip_crate_wait("real-package-name"));
    }

    #[test]
    fn index_paths_follow_the_registry_layout() {
        assert_eq!(index_path("a"), "1/a");
        assert_eq!(index_path("ab"), "2/ab");
        assert_eq!(index_path("abc"), "3/a/abc");
        assert_eq!(index_path("serde"), "se/rd/serde");
        assert_eq!(
            index_path("links-notation"),
            "li/nk/links-notation",
            "the layout used by the crate from issue #143"
        );
        assert_eq!(index_path("Serde"), "se/rd/serde", "names are lowercased");
    }

    #[test]
    fn index_url_points_at_the_sparse_index() {
        assert_eq!(index_url("serde"), "https://index.crates.io/se/rd/serde");
    }

    #[test]
    fn api_url_points_at_the_version_endpoint() {
        assert_eq!(
            api_url("serde", "1.0.228"),
            "https://crates.io/api/v1/crates/serde/1.0.228"
        );
    }

    #[test]
    fn user_agent_carries_contact_information() {
        assert!(
            USER_AGENT.contains("+https://"),
            "crates.io asks that clients be reachable"
        );
    }

    #[test]
    fn index_body_matches_the_published_version_only() {
        let body = concat!(
            r#"{"name":"links-notation","vers":"0.15.0","deps":[]}"#,
            "\n",
            r#"{"name":"links-notation","vers":"0.16.0","deps":[]}"#,
            "\n"
        );

        assert!(index_body_has_version(body, "0.16.0"));
        assert!(index_body_has_version(body, "0.15.0"));
        assert!(!index_body_has_version(body, "0.17.0"));
        assert!(
            !index_body_has_version(body, "0.16"),
            "a prefix of a published version is not that version"
        );
    }

    #[test]
    fn index_body_tolerates_whitespace_around_the_version_field() {
        let body = r#"{"name":"demo", "vers" : "1.2.3" }"#;
        assert!(index_body_has_version(body, "1.2.3"));
    }

    /// The regression from issue #143: a throttled or forbidden probe must not
    /// be classified as "not published".
    #[test]
    fn throttled_and_forbidden_probes_are_unknown_not_missing() {
        for status in [403_u16, 429, 500, 502, 503] {
            assert!(
                matches!(
                    classify_index_response(status, "", "1.0.0"),
                    Visibility::Unknown(_)
                ),
                "index HTTP {} must not be reported as a missing version",
                status
            );
            assert!(
                matches!(classify_api_status(status), Visibility::Unknown(_)),
                "API HTTP {} must not be reported as a missing version",
                status
            );
        }
    }

    #[test]
    fn definitive_answers_are_classified_as_such() {
        assert_eq!(
            classify_index_response(200, r#"{"vers":"1.0.0"}"#, "1.0.0"),
            Visibility::Published
        );
        assert_eq!(
            classify_index_response(200, r#"{"vers":"0.9.0"}"#, "1.0.0"),
            Visibility::NotPublishedYet
        );
        assert_eq!(
            classify_index_response(404, "", "1.0.0"),
            Visibility::NotPublishedYet
        );
        assert_eq!(classify_api_status(200), Visibility::Published);
        assert_eq!(classify_api_status(404), Visibility::NotPublishedYet);
    }

    #[test]
    fn a_definitive_answer_from_either_source_wins() {
        assert_eq!(
            combine(
                Visibility::Unknown("index.crates.io responded HTTP 429".into()),
                Visibility::Published
            ),
            Visibility::Published
        );
        assert_eq!(
            combine(
                Visibility::NotPublishedYet,
                Visibility::Unknown("crates.io API responded HTTP 403".into())
            ),
            Visibility::NotPublishedYet
        );
    }

    #[test]
    fn unknown_is_reported_only_when_neither_source_answered() {
        let combined = combine(
            Visibility::Unknown("index.crates.io responded HTTP 429".into()),
            Visibility::Unknown("crates.io API responded HTTP 403".into()),
        );

        let Visibility::Unknown(reason) = combined else {
            panic!("two unusable answers must combine into Unknown");
        };
        assert!(reason.contains("429") && reason.contains("403"));
    }

    /// The false negative from issue #143: the failure message must not claim
    /// the release did not happen when nothing was ever established.
    #[test]
    fn failure_message_distinguishes_unknown_from_missing() {
        let unknown = failure_message(
            "links-notation",
            "0.16.0",
            30,
            Some("crates.io API responded HTTP 403"),
        );
        assert!(
            unknown.contains("could not determine"),
            "unknown outcome must not be phrased as a missing version: {}",
            unknown
        );
        assert!(
            unknown.contains("does NOT mean the publish failed"),
            "the message must point the reader away from the publish step: {}",
            unknown
        );
        assert!(
            unknown.contains("https://index.crates.io/li/nk/links-notation"),
            "the message must show how to verify against the sparse index: {}",
            unknown
        );
        assert!(
            !unknown.contains("was not visible on crates.io after"),
            "unknown outcome must not reuse the missing-version wording: {}",
            unknown
        );

        let missing = failure_message("links-notation", "0.16.0", 30, None);
        assert_eq!(
            missing,
            "Error: links-notation@0.16.0 was not visible on crates.io after 30 attempts"
        );
    }
}
