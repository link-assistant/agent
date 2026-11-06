#!/usr/bin/env rust-script
//! Check if a changelog fragment was added in the current PR
//!
//! This script validates that a changelog fragment is added in the PR diff,
//! not just checking if any fragments exist in the directory. This prevents
//! the check from incorrectly passing when there are leftover fragments
//! from previous PRs that haven't been released yet.
//!
//! Usage: rust-script scripts/check-changelog-fragment.rs
//!
//! Environment variables (set by GitHub Actions):
//!   - GITHUB_BASE_REF: Base branch name for PR (e.g., "main")
//!
//! Exit codes:
//!   - 0: Check passed (fragment added or no source changes)
//!   - 1: Check failed (source changes without changelog fragment)
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use regex::Regex;
use std::env;
use std::path::Path;
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

fn fetch_base(base_ref: &str) -> Result<(), String> {
    let refspec = format!("refs/heads/{base_ref}:refs/remotes/origin/{base_ref}");
    let shallow = exec("git", &["rev-parse", "--is-shallow-repository"])? == "true";
    let mut args = vec!["fetch", "origin"];
    if shallow {
        args.push("--unshallow");
    }
    args.push(&refspec);
    exec("git", &args).map(|_| ())
}

fn get_rust_root() -> String {
    if let Ok(root) = env::var("RUST_ROOT") {
        if !root.is_empty() {
            return root;
        }
    }

    if Path::new("./Cargo.toml").exists() {
        return ".".to_string();
    }

    if Path::new("./rust/Cargo.toml").exists() {
        return "rust".to_string();
    }

    ".".to_string()
}

fn get_changed_files(added_only: bool) -> Result<Vec<String>, String> {
    let base_ref = env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".to_string());
    eprintln!("Comparing against origin/{}...HEAD", base_ref);
    let comparison = format!("origin/{base_ref}...HEAD");
    let mut diff_args = vec!["diff", "--name-only", "-z", comparison.as_str()];
    if added_only {
        // A replaced fragment is new; a byte-identical move of a pending one is not.
        diff_args.push("--find-renames=100%");
        diff_args.push("--diff-filter=A");
    } else {
        // Include both paths of a move, especially source moved out of src/.
        diff_args.push("--no-renames");
    }
    let output = match exec("git", &diff_args) {
        Ok(output) => output,
        Err(first_error) => {
            eprintln!(
                "Initial diff failed ({first_error}); fetching the explicit base ref and retrying."
            );
            fetch_base(&base_ref).map_err(|fetch_error| {
                format!("could not prepare base after diff failure ({first_error}); {fetch_error}")
            })?;
            exec("git", &diff_args)?
        }
    };
    Ok(output
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect())
}

fn is_source_file(file_path: &str, rust_root: &str) -> bool {
    let prefix = if rust_root == "." {
        String::new()
    } else {
        format!("{}/", rust_root)
    };

    let source_patterns = [
        Regex::new(&format!(r"^{}(?:[^/]+/)*src/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}(?:[^/]+/)*tests/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(
            r"^(?:{}scripts/|scripts/)",
            regex::escape(&prefix)
        ))
        .unwrap(),
        Regex::new(&format!(
            r"^{}(?:[^/]+/)*Cargo\.toml$",
            regex::escape(&prefix)
        ))
        .unwrap(),
    ];

    source_patterns
        .iter()
        .any(|pattern| pattern.is_match(file_path))
}

fn is_changelog_fragment(file_path: &str, rust_root: &str) -> bool {
    let changelog_dir = if rust_root == "." {
        "changelog.d/".to_string()
    } else {
        format!("{}/changelog.d/", rust_root)
    };

    let path = Path::new(file_path);
    path.parent() == Some(Path::new(&changelog_dir))
        && path.extension().is_some_and(|ext| ext == "md")
        && path.file_name().is_some_and(|name| name != "README.md")
}

fn is_exempt_author(author: &str) -> bool {
    author == "dependabot[bot]"
}

fn main() {
    let author = env::var("PR_AUTHOR").unwrap_or_default();
    if is_exempt_author(&author) {
        println!("Skipping changelog requirement for PR author {author}");
        return;
    }
    println!("Checking for changelog fragment in PR diff...\n");

    let rust_root =
        rust_paths::repository_relative_root(&get_rust_root()).unwrap_or_else(|error| {
            eprintln!("::error::{error}");
            exit(1);
        });
    if rust_root != "." {
        println!(
            "Detected multi-language repository (Rust root: {})",
            rust_root
        );
    }

    let changed_files = match get_changed_files(false) {
        Ok(files) => files,
        Err(error) => {
            eprintln!("::error::Could not determine the PR's changed files: {error}");
            exit(1);
        }
    };

    if changed_files.is_empty() {
        println!("No changed files found");
        exit(0);
    }

    println!("Changed files:");
    for file in &changed_files {
        println!("  {}", file);
    }
    println!();

    // Count source files changed
    let source_changes: Vec<&String> = changed_files
        .iter()
        .filter(|f| is_source_file(f, &rust_root))
        .collect();
    let source_changed_count = source_changes.len();

    println!("Source files changed: {}", source_changed_count);
    if source_changed_count > 0 {
        for file in &source_changes {
            println!("  {}", file);
        }
    }
    println!();

    // Count changelog fragments added in this PR
    let added_files = get_changed_files(true).unwrap_or_else(|error| {
        eprintln!("::error::Could not determine added fragments: {error}");
        exit(1);
    });
    let fragments_added: Vec<&String> = added_files
        .iter()
        .filter(|f| is_changelog_fragment(f, &rust_root))
        .collect();
    let fragment_added_count = fragments_added.len();

    println!("Changelog fragments added: {}", fragment_added_count);
    if fragment_added_count > 0 {
        for file in &fragments_added {
            println!("  {}", file);
        }
    }
    println!();

    // Check if source files changed but no fragment was added
    if source_changed_count > 0 && fragment_added_count == 0 {
        eprintln!("::error::No changelog fragment found in this PR. Please add a changelog entry in changelog.d/");
        eprintln!();
        eprintln!("To create a changelog fragment:");
        eprintln!("  Create a new .md file in changelog.d/ with your changes");
        eprintln!();
        eprintln!("See changelog.d/README.md for more information.");
        exit(1);
    }

    println!(
        "Changelog check passed (source files changed: {}, fragments added: {})",
        source_changed_count, fragment_added_count
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_dependabot_author_is_exempt() {
        assert!(is_exempt_author("dependabot[bot]"));
        for author in ["", "human", "dependabot", "dependabot/branch", "Dependabot[bot]"] {
            assert!(!is_exempt_author(author));
        }
    }

    #[test]
    fn command_failure_is_not_an_empty_success() {
        let error = exec(
            "git",
            &["diff", "--name-only", "definitely-not-a-ref...HEAD"],
        )
        .expect_err("an invalid revision must remain an error");
        assert!(error.contains("exited with"));
    }
}
