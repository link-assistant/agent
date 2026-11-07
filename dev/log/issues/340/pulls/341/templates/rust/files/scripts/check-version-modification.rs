#!/usr/bin/env rust-script
//! Deny manual package/workspace version changes in every pull request.
//! Branch names do not establish trusted release provenance. Compare parsed
//! TOML from the merge base and HEAD, so formatting and dependency edits pass.
//! Supports root, nested Rust roots and workspace member manifests.
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! toml = "0.8"
//! ```

use std::env;
use std::process::{exit, Command};

#[path = "rust-paths.rs"]
mod rust_paths;

fn exec(command: &str, args: &[&str]) -> Result<String, String> {
    match Command::new(command).args(args).output() {
        Ok(output) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        Ok(output) => Err(format!(
            "{} {:?} exited with {}: {}",
            command,
            args,
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(error) => Err(format!(
            "failed to execute {} {:?}: {}",
            command, args, error
        )),
    }
}

fn merge_base() -> Result<String, String> {
    let base_ref = env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".to_string());
    let remote_ref = format!("origin/{base_ref}");
    let args = ["merge-base", remote_ref.as_str(), "HEAD"];
    match exec("git", &args) {
        Ok(base) => Ok(base),
        Err(first_error) => {
            eprintln!("Initial comparison failed ({first_error}); fetching explicit base ref.");
            let refspec = format!("refs/heads/{base_ref}:refs/remotes/origin/{base_ref}");
            let shallow = exec("git", &["rev-parse", "--is-shallow-repository"])? == "true";
            let mut fetch = vec!["fetch", "origin"];
            if shallow {
                fetch.push("--unshallow");
            }
            fetch.push(&refspec);
            exec("git", &fetch)?;
            exec("git", &args)
        }
    }
}

fn versions(content: &str) -> Result<Vec<Option<toml::Value>>, String> {
    let document: toml::Value =
        toml::from_str(content).map_err(|e| format!("invalid TOML: {e}"))?;
    Ok(vec![
        document
            .get("package")
            .and_then(|p| p.get("version"))
            .cloned(),
        document
            .get("workspace")
            .and_then(|w| w.get("package"))
            .and_then(|p| p.get("version"))
            .cloned(),
    ])
}

fn check_versions() -> Result<(), String> {
    let rust_root = rust_paths::repository_relative_root(&rust_paths::get_rust_root(None, false)?)?;
    let base = merge_base()?;
    let changed = exec(
        "git",
        &[
            "diff",
            "--name-only",
            "-z",
            "--diff-filter=M",
            &base,
            "HEAD",
        ],
    )?;
    let prefix = if rust_root == "." {
        String::new()
    } else {
        format!(
            "{}/",
            rust_root.trim_start_matches("./").trim_end_matches('/')
        )
    };
    for path in changed.split('\0').filter(|p| !p.is_empty()) {
        if !path.starts_with(&prefix) || !(path == "Cargo.toml" || path.ends_with("/Cargo.toml")) {
            continue;
        }
        let before = exec("git", &["show", &format!("{base}:{path}")])?;
        let after = exec("git", &["show", &format!("HEAD:{path}")])?;
        let before = versions(&before).map_err(|e| format!("{path} at merge base: {e}"))?;
        let after = versions(&after).map_err(|e| format!("{path} at HEAD: {e}"))?;
        if before != after {
            return Err(format!("Manual version change detected in {path}. Versions are managed automatically; add a new changelog fragment instead."));
        }
    }
    Ok(())
}

fn main() {
    let event = env::var("GITHUB_EVENT_NAME").unwrap_or_default();
    if event != "pull_request" {
        println!("Skipping version check for event: {event}");
        return;
    }
    if let Err(error) = check_versions() {
        eprintln!("::error::{error}");
        exit(1);
    }
    println!("Version check passed.");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatting_and_dependency_versions_do_not_change_package_version() {
        assert_eq!(
            versions("[package]\nversion=\"1.0.0\"\n").unwrap(),
            versions("[package]\n version = '1.0.0'\n[dependencies.x]\nversion='2'\n").unwrap()
        );
    }

    #[test]
    fn workspace_versions_are_compared_and_invalid_toml_is_an_error() {
        assert_ne!(
            versions("[workspace.package]\nversion='1.0.0'\n").unwrap(),
            versions("[workspace.package]\nversion='2.0.0'\n").unwrap()
        );
        assert!(versions("[package").is_err());
    }

    #[test]
    fn command_failure_is_not_an_empty_success() {
        assert!(exec("git", &["diff", "definitely-not-a-ref...HEAD"]).is_err());
    }
}
