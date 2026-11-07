#!/usr/bin/env rust-script
//! Publish package to crates.io
//!
//! This script publishes the Rust package to crates.io and handles
//! the case where the version already exists.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml in repository root
//! - Multi-language: Cargo.toml in rust/ subfolder
//!
//! Usage: rust-script scripts/publish-crate.rs [--token <token>] [--rust-root <path>]
//!
//! Environment variables (checked in order of priority):
//!   - CARGO_REGISTRY_TOKEN: Cargo's native crates.io token (preferred)
//!   - CARGO_TOKEN: Alternative token name for backwards compatibility
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - publish_result: one of
//!       'success'        - the crate version was published to crates.io
//!       'already_exists' - the version is already on crates.io (version-bump bug)
//!       'auth_failed'    - missing or invalid crates.io authentication token
//!       'rate_limited'   - crates.io returned HTTP 429 (too many versions in 24h);
//!                          deferred, automatically-recoverable outcome — the
//!                          script exits 0 and the same version is retried on the
//!                          next push to 'main' once the throttle window clears
//!       'skipped'        - publish skipped (e.g. template default package name)
//!       'failed'         - publish failed for an unrecognised reason
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use std::env;
use std::process::{exit, Command};

#[path = "rust-paths.rs"]
mod rust_paths;

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    None
}

fn needs_cd(rust_root: &str) -> bool {
    rust_root != "."
}

#[path = "github-output.rs"]
mod github_output;

fn set_output(key: &str, value: &str) -> std::io::Result<()> {
    github_output::write_output(key, value)?;
    println!("Output: {key}={value}");
    Ok(())
}

/// Classification of a failed `cargo publish` attempt.
///
/// Every failure branch funnels through this single enum so the `publish_result`
/// output value and the catch-all behaviour cannot drift apart over time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FailureKind {
    AlreadyExists,
    AuthFailed,
    RateLimited,
    Unknown,
}

impl FailureKind {
    fn output_value(self) -> &'static str {
        match self {
            FailureKind::AlreadyExists => "already_exists",
            FailureKind::AuthFailed => "auth_failed",
            FailureKind::RateLimited => "rate_limited",
            FailureKind::Unknown => "failed",
        }
    }

    /// Whether this failure is a *deferred*, automatically-recoverable outcome
    /// rather than a hard error.
    ///
    /// A crates.io HTTP 429 throttle is transient: the same version is re-tried
    /// on the next push to `main` once the 24-hour window clears (see
    /// `scripts/check-release-needed.rs`). The script therefore exits
    /// successfully for this case so a recoverable throttle does not turn the
    /// whole release job red. Every other failure stays non-zero.
    fn is_deferred(self) -> bool {
        matches!(self, FailureKind::RateLimited)
    }
}

/// Classify a combined stdout/stderr blob from `cargo publish` into a
/// [`FailureKind`].
///
/// Note: the rate-limit checks come before the auth checks because a crates.io
/// 429 body never contains the auth-token markers, while the rate-limit markers
/// are unambiguous.
fn classify_failure(combined: &str) -> FailureKind {
    if combined.contains("already uploaded") || combined.contains("already exists") {
        FailureKind::AlreadyExists
    } else if combined.contains("429 Too Many Requests")
        || combined.contains("Too Many Requests")
        || combined.contains("too many versions")
        || combined.contains("too many requests")
    {
        FailureKind::RateLimited
    } else if combined.contains("non-empty token")
        || combined.contains("please provide a")
        || combined.contains("unauthorized")
        || combined.contains("authentication")
    {
        FailureKind::AuthFailed
    } else {
        FailureKind::Unknown
    }
}

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

    // Get token from CLI arg, then env vars
    let token = get_arg("token")
        .or_else(|| {
            env::var("CARGO_REGISTRY_TOKEN")
                .ok()
                .filter(|s| !s.is_empty())
        })
        .or_else(|| env::var("CARGO_TOKEN").ok().filter(|s| !s.is_empty()));

    let package_info = match rust_paths::read_package_info(&package_manifest) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let name = package_info.name;
    let version = package_info.version;

    println!("Package: {}@{}", name, version);

    if name == "example-sum-package-name" {
        println!(
            "Skipping publish: package name is the template default 'example-sum-package-name'"
        );
        println!("Rename the package in Cargo.toml before publishing to crates.io");
        set_output("publish_result", "skipped")?;
        return Ok(());
    }

    println!();
    println!("=== Attempting to publish to crates.io ===");

    if token.is_none() {
        println!("::warning::Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set, attempting publish without explicit token");
        println!();
        println!("To fix this, ensure one of the following secrets is configured:");
        println!("  - CARGO_REGISTRY_TOKEN (Cargo's native env var, preferred)");
        println!("  - CARGO_TOKEN (alternative for backwards compatibility)");
        println!();
        println!("For organization secrets, you may need to map the secret name in your workflow:");
        println!("  env:");
        println!("    CARGO_REGISTRY_TOKEN: ${{{{ secrets.CARGO_TOKEN }}}}");
        println!();
    } else {
        println!("Using provided authentication token");
    }

    // Build the cargo publish command
    let mut cmd = Command::new("cargo");
    cmd.arg("publish").arg("--allow-dirty").arg("-p").arg(&name);

    if let Some(t) = &token {
        cmd.env("CARGO_REGISTRY_TOKEN", t);
    }

    // For multi-language repos, change to the rust directory
    if needs_cd(&rust_root) {
        cmd.current_dir(&rust_root);
    }

    let output = cmd.output().expect("Failed to execute cargo publish");

    if output.status.success() {
        println!("Successfully published {}@{} to crates.io", name, version);
        set_output("publish_result", "success")?;
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}\n{}", stdout, stderr);

        let kind = classify_failure(&combined);
        match kind {
            FailureKind::AlreadyExists => {
                eprintln!();
                eprintln!("=== VERSION ALREADY PUBLISHED ===");
                eprintln!();
                eprintln!("Version {} already exists on crates.io.", version);
                eprintln!("The release pipeline must always publish a version greater than what is already published.");
                eprintln!("This indicates a bug in version bumping: the pipeline should have computed a new, unpublished version.");
                eprintln!();
            }
            FailureKind::RateLimited => {
                eprintln!();
                eprintln!("=== CRATES.IO RATE LIMIT (HTTP 429) ===");
                eprintln!();
                eprintln!("crates.io rejected the publish because too many versions of this");
                eprintln!("crate have been published in the last 24 hours.");
                eprintln!();
                eprintln!("Original cargo publish error:");
                eprintln!("{}", combined.trim());
                eprintln!();
                eprintln!(
                    "This is a TRANSIENT, automatically-recoverable throttle, not a pipeline bug."
                );
                eprintln!(
                    "No action is required other than waiting for the 24-hour window to roll over."
                );
                eprintln!(
                    "scripts/check-release-needed.rs will re-attempt the same version on the next"
                );
                eprintln!("push to 'main' once the throttle window has cleared.");
                eprintln!();
                eprintln!("See: https://doc.rust-lang.org/cargo/reference/publishing.html#publishing-a-new-version-of-an-existing-crate");
                eprintln!();
            }
            FailureKind::AuthFailed => {
                eprintln!();
                eprintln!("=== AUTHENTICATION FAILURE ===");
                eprintln!();
                eprintln!("Failed to publish due to missing or invalid authentication token.");
                eprintln!();
                eprintln!(
                    "SOLUTION: Configure one of these secrets in your repository or organization:"
                );
                eprintln!(
                    "  1. CARGO_REGISTRY_TOKEN - Cargo's native environment variable (preferred)"
                );
                eprintln!("  2. CARGO_TOKEN - Alternative name for backwards compatibility");
                eprintln!();
                eprintln!(
                    "If using organization secrets with a different name, map it in your workflow:"
                );
                eprintln!("  - name: Publish to Crates.io");
                eprintln!("    env:");
                eprintln!("      CARGO_REGISTRY_TOKEN: ${{{{ secrets.YOUR_SECRET_NAME }}}}");
                eprintln!();
                eprintln!("See: https://doc.rust-lang.org/cargo/reference/publishing.html");
                eprintln!();
            }
            FailureKind::Unknown => {
                eprintln!("Failed to publish for unknown reason");
                eprintln!("{}", combined);
            }
        }

        set_output("publish_result", kind.output_value())?;

        // A rate-limit is a deferred, automatically-recoverable outcome: exit
        // successfully so the release job does not go red over a transient
        // crates.io throttle. Downstream release-artifact steps are gated on a
        // successful publish (see .github/workflows/release.yml), so a deferred
        // upload never produces partial Docker/GitHub release artifacts.
        if kind.is_deferred() {
            return Ok(());
        }

        exit(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_already_exists_response() {
        let body = "error: crate version 0.1.0 is already uploaded";
        assert_eq!(classify_failure(body), FailureKind::AlreadyExists);
        assert_eq!(FailureKind::AlreadyExists.output_value(), "already_exists");
    }

    #[test]
    fn classifies_rate_limit_response() {
        let body = "\
error: failed to publish my-crate v0.42.0 to registry at https://crates.io

Caused by:
  the remote server responded with an error (status 429 Too Many Requests): \
You have published too many versions of this crate in the last 24 hours
";
        assert_eq!(classify_failure(body), FailureKind::RateLimited);
        assert_eq!(FailureKind::RateLimited.output_value(), "rate_limited");
    }

    #[test]
    fn classifies_rate_limit_from_too_many_versions_marker() {
        let body = "the remote server responded: You have published too many versions";
        assert_eq!(classify_failure(body), FailureKind::RateLimited);
    }

    #[test]
    fn classifies_auth_failure_response() {
        let body = "error: failed to publish: please provide a non-empty token";
        assert_eq!(classify_failure(body), FailureKind::AuthFailed);
        assert_eq!(FailureKind::AuthFailed.output_value(), "auth_failed");
    }

    #[test]
    fn classifies_unknown_response() {
        let body = "error: some brand new failure mode nobody has seen before";
        assert_eq!(classify_failure(body), FailureKind::Unknown);
        assert_eq!(FailureKind::Unknown.output_value(), "failed");
    }

    #[test]
    fn rate_limit_takes_precedence_over_auth_markers() {
        // A 429 body that also happens to mention "authentication" must still be
        // classified as rate-limited, since the throttle is the actionable cause.
        let body = "status 429 Too Many Requests: authentication retry later";
        assert_eq!(classify_failure(body), FailureKind::RateLimited);
    }

    #[test]
    fn only_rate_limit_is_deferred() {
        // A rate-limit is the single deferred (exit-0) outcome; every other
        // failure must remain a hard, non-zero error.
        assert!(FailureKind::RateLimited.is_deferred());
        assert!(!FailureKind::AlreadyExists.is_deferred());
        assert!(!FailureKind::AuthFailed.is_deferred());
        assert!(!FailureKind::Unknown.is_deferred());
    }
}
