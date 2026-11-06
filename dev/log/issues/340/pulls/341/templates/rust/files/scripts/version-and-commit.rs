#!/usr/bin/env rust-script
//! Bump version in Cargo.toml and commit changes
//! Used by the CI/CD pipeline for releases
//!
//! IMPORTANT: This script checks crates.io (the source of truth for Rust packages),
//! NOT git tags, which can exist before a package is published.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml and changelog.d/ in repository root
//! - Multi-language: Cargo.toml and changelog.d/ in rust/ subfolder
//!
//! Usage: rust-script scripts/version-and-commit.rs --bump-type <major|minor|patch> [--description <desc>] [--rust-root <path>] [--tag-prefix <prefix>] [--release-label <label>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! chrono = "0.4"
//! ureq = "2"
//! serde = { version = "1", features = ["derive"] }
//! serde_json = "1"
//! ```

// Test harnesses replace main; the real build still denies unused helpers.
#![cfg_attr(test, allow(dead_code))]

#[cfg(not(test))]
use chrono::Utc;
use regex::Regex;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::process::exit;
use std::process::Command;

#[path = "release-index.rs"]
mod release_index;

#[path = "release-content.rs"]
mod release_content;

#[path = "release-naming.rs"]
mod release_naming;
#[path = "rust-paths.rs"]
mod rust_paths;

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

fn get_changelog_dir(rust_root: &str) -> String {
    if rust_root == "." {
        "./changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    }
}

fn get_changelog_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./CHANGELOG.md".to_string()
    } else {
        format!("{}/CHANGELOG.md", rust_root)
    }
}

#[path = "changelog-files.rs"]
mod changelog_files;

#[path = "github-output.rs"]
mod github_output;

fn set_output(key: &str, value: &str) -> std::io::Result<()> {
    github_output::write_output(key, value)?;
    println!("Output: {key}={value}");
    Ok(())
}

fn exec(command: &str, args: &[&str]) -> Result<String, String> {
    match Command::new(command).args(args).output() {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                // Both streams: git writes push rejections to stderr but some
                // helpers log to stdout, and classifying a failure (issue #162)
                // must see everything the command printed.
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!(
                    "Command `{}` failed.\nstdout: {}\nstderr: {}",
                    command,
                    stdout.trim(),
                    stderr.trim()
                ))
            }
        }
        Err(e) => Err(format!("Failed to execute: {}", e)),
    }
}

fn exec_check(command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Not every failed `git push` is a lost race (issue #162). A repository
/// ruleset rejection arrives shaped like a non-fast-forward, and rebasing
/// against a policy refusal three times burns the job's budget before dying
/// with a misleading "conflict" error, so the failure is classified first.
const REPOSITORY_RULE_PATTERNS: &[&str] = &[
    "gh006",
    "gh013",
    "repository rule violations",
    "changes must be made through a pull request",
    "protected branch",
    "push declined",
];

const NON_FAST_FORWARD_PATTERNS: &[&str] = &[
    "[rejected]",
    "non-fast-forward",
    "fetch first",
    "updates were rejected",
];

#[derive(Debug, PartialEq, Eq)]
enum PushFailure {
    /// A repository ruleset refuses the push; retrying cannot fix policy.
    RepositoryRules,
    /// The remote branch moved; rebase onto it and try again.
    LostRace,
    /// Anything else: report the real error instead of masking it.
    Other,
}

fn classify_push_failure(raw_output: &str) -> PushFailure {
    let haystack = raw_output.to_lowercase();
    // Rules first: a ruleset rejection also contains the word "rejected".
    if REPOSITORY_RULE_PATTERNS
        .iter()
        .any(|pattern| haystack.contains(pattern))
    {
        return PushFailure::RepositoryRules;
    }
    if NON_FAST_FORWARD_PATTERNS
        .iter()
        .any(|pattern| haystack.contains(pattern))
    {
        return PushFailure::LostRace;
    }
    PushFailure::Other
}

struct Version {
    major: u32,
    minor: u32,
    patch: u32,
    #[allow(dead_code)]
    pre_release: Option<String>,
}

impl Version {
    fn parse(content: &str) -> Option<Version> {
        let re = Regex::new(r#"(?m)^version\s*=\s*"(\d+)\.(\d+)\.(\d+)(?:-([^"]+))?""#).ok()?;
        let caps = re.captures(content)?;
        Some(Version {
            major: caps.get(1)?.as_str().parse().ok()?,
            minor: caps.get(2)?.as_str().parse().ok()?,
            patch: caps.get(3)?.as_str().parse().ok()?,
            pre_release: caps.get(4).map(|m| m.as_str().to_string()),
        })
    }

    fn bump(&self, bump_type: &str) -> String {
        match bump_type {
            "major" => format!("{}.0.0", self.major + 1),
            "minor" => format!("{}.{}.0", self.major, self.minor + 1),
            _ => format!("{}.{}.{}", self.major, self.minor, self.patch + 1),
        }
    }
}

fn update_cargo_toml(cargo_toml_path: &str, new_version: &str) -> Result<(), String> {
    let content = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {}", cargo_toml_path, e))?;

    let re = Regex::new(r#"(?m)^(version\s*=\s*")[^"]+(")"#).unwrap();
    let new_content = re.replace(&content, format!("${{1}}{}${{2}}", new_version).as_str());

    fs::write(cargo_toml_path, new_content.as_ref())
        .map_err(|e| format!("Failed to write {}: {}", cargo_toml_path, e))?;

    println!("Updated {} to version {}", cargo_toml_path, new_version);
    Ok(())
}

fn update_cargo_lock(
    cargo_lock_path: &Path,
    crate_name: &str,
    new_version: &str,
) -> Result<bool, String> {
    if !cargo_lock_path.exists() {
        println!(
            "No Cargo.lock at {} (skipping lock-file version sync)",
            cargo_lock_path.display()
        );
        return Ok(false);
    }

    let path_str = cargo_lock_path.to_string_lossy();
    let content = fs::read_to_string(cargo_lock_path)
        .map_err(|e| format!("Failed to read {}: {}", path_str, e))?;

    let pattern = format!(
        r#"(?m)(\[\[package\]\]\s*\nname\s*=\s*"{}"\s*\nversion\s*=\s*")[^"]+(")"#,
        regex::escape(crate_name),
    );
    let re =
        Regex::new(&pattern).map_err(|e| format!("Failed to build Cargo.lock regex: {}", e))?;

    if !re.is_match(&content) {
        println!(
            "Warning: Could not find [[package]] entry for `{}` in {} (lock file left untouched)",
            crate_name, path_str
        );
        return Ok(false);
    }

    let new_content = re.replace(&content, format!("${{1}}{}${{2}}", new_version).as_str());

    if new_content == content {
        println!("Cargo.lock already at version {}", new_version);
        return Ok(false);
    }

    fs::write(cargo_lock_path, new_content.as_ref())
        .map_err(|e| format!("Failed to write {}: {}", path_str, e))?;

    println!("Updated {} to version {}", path_str, new_version);
    Ok(true)
}

fn get_crate_name(cargo_toml_path: &str) -> Result<String, String> {
    let content = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {}", cargo_toml_path, e))?;

    let re = Regex::new(r#"(?m)^name\s*=\s*"([^"]+)""#).unwrap();

    if let Some(caps) = re.captures(&content) {
        Ok(caps.get(1).unwrap().as_str().to_string())
    } else {
        Err(format!("Could not find name in {}", cargo_toml_path))
    }
}

fn check_tag_exists(tag_prefix: &str, version: &str) -> bool {
    exec_check("git", &["rev-parse", &format!("{}{}", tag_prefix, version)])
}

#[cfg(not(test))]
#[path = "registry.rs"]
mod registry;

#[cfg(not(test))]
#[path = "version-and-commit/crates-io.rs"]
mod crates_io;
#[cfg(not(test))]
use crates_io::{ensure_version_exceeds_published, get_max_published_version};

fn strip_frontmatter(content: &str) -> String {
    let re = Regex::new(r"(?s)^---\s*\n.*?\n---\s*\n(.*)$").unwrap();
    if let Some(caps) = re.captures(content) {
        caps.get(1).unwrap().as_str().trim().to_string()
    } else {
        content.trim().to_string()
    }
}

fn remove_changelog_fragments(files: &[PathBuf]) {
    for file in files {
        fs::remove_file(file)
            .unwrap_or_else(|e| panic!("Failed to remove {}: {}", file.display(), e));
        println!("Removed {}", file.display());
    }
}

#[cfg(not(test))]
fn collect_changelog(changelog_dir: &str, changelog_file: &str, version: &str) {
    let date_str = Utc::now().format("%Y-%m-%d").to_string();
    collect_changelog_with_date(changelog_dir, changelog_file, version, &date_str);
}

fn collect_changelog_with_date(
    changelog_dir: &str,
    changelog_file: &str,
    version: &str,
    date_str: &str,
) {
    let files = changelog_files::list_fragments(Path::new(changelog_dir))
        .unwrap_or_else(|error| panic!("{error}"));
    if files.is_empty() {
        return;
    }

    let fragments: Vec<String> = files
        .iter()
        .map(|file| changelog_files::read_file(file).unwrap_or_else(|error| panic!("{error}")))
        .map(|c| strip_frontmatter(&c))
        .filter(|c| !c.is_empty())
        .collect();

    if fragments.is_empty() {
        return;
    }

    let new_entry = format!(
        "\n## [{}] - {}\n\n{}\n",
        version,
        date_str,
        fragments.join("\n\n")
    );

    if !Path::new(changelog_file).exists() {
        return;
    }

    let mut content = changelog_files::read_file(Path::new(changelog_file))
        .unwrap_or_else(|error| panic!("{error}"));
    if let Some(heading) = release_content::release_headings(&content).first() {
        content.insert_str(heading.start, &new_entry);
    } else {
        content.push_str(&new_entry);
    }

    fs::write(changelog_file, content).expect("Failed to write changelog");
    remove_changelog_fragments(&files);
    println!("Collected {} changelog fragment(s)", files.len());
}

/// Number of unconsumed changelog fragments (.md files other than README.md).
fn count_changelog_fragments(changelog_dir: &str) -> usize {
    changelog_files::list_fragments(Path::new(changelog_dir))
        .unwrap_or_else(|error| panic!("{error}"))
        .len()
}

/// Verify the release write before it becomes a commit (issue #159).
///
/// The version commit is pushed straight to the default branch by GITHUB_TOKEN,
/// and a push made with GITHUB_TOKEN does not trigger any workflow -- nothing
/// ever lints, formats or tests this commit. Whatever is wrong here ships
/// unreviewed, so the write itself is verified: the changelog actually gained
/// the new version (when fragments were collected), no fragment leaked past
/// this release, and Cargo.lock agrees with the bumped Cargo.toml.
fn verify_release_write(
    changelog_file: &str,
    changelog_dir: &str,
    cargo_lock_path: &Path,
    crate_name: &str,
    new_version: &str,
    expect_new_entry: bool,
) -> Result<(), String> {
    if expect_new_entry {
        let changelog = fs::read_to_string(changelog_file).map_err(|e| {
            format!(
                "CHANGELOG verification failed: cannot read {}: {}",
                changelog_file, e
            )
        })?;
        let entry = Regex::new(&format!(
            r"(?m)^## \[{}\] - \d{{4}}-\d{{2}}-\d{{2}}\s*$",
            regex::escape(new_version)
        ))
        .map_err(|e| format!("Failed to build changelog verification regex: {}", e))?;
        if !release_content::release_headings(&changelog)
            .iter()
            .any(|heading| entry.is_match(&changelog[heading.start..heading.body_start]))
        {
            return Err(format!(
                "CHANGELOG verification failed: {} does not contain a well-formed \
                 '## [{}] - YYYY-MM-DD' entry after collecting the fragments",
                changelog_file, new_version
            ));
        }
    }

    let leftover: Vec<String> = changelog_files::list_fragments(Path::new(changelog_dir))
        .map_err(|error| format!("CHANGELOG verification failed: {error}"))?
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    if !leftover.is_empty() {
        return Err(format!(
            "CHANGELOG verification failed: fragments were not consumed and would \
             leak into the next release: {}. Empty or malformed fragments must be \
             fixed or removed, not left behind.",
            leftover.join(", ")
        ));
    }

    if cargo_lock_path.exists() {
        let lock = fs::read_to_string(cargo_lock_path).map_err(|e| {
            format!(
                "Cargo.lock verification failed: cannot read {}: {}",
                cargo_lock_path.display(),
                e
            )
        })?;
        let entry = Regex::new(&format!(
            r#"(?m)\[\[package\]\]\s*\nname\s*=\s*"{}"\s*\nversion\s*=\s*"([^"]+)""#,
            regex::escape(crate_name),
        ))
        .map_err(|e| format!("Failed to build Cargo.lock verification regex: {}", e))?;
        if let Some(caps) = entry.captures(&lock) {
            let locked_version = caps.get(1).map_or("", |m| m.as_str());
            if locked_version != new_version {
                return Err(format!(
                    "Cargo.lock verification failed: {} has `{}` at version `{}` but \
                     Cargo.toml was bumped to `{}` -- the lock file disagrees with the \
                     manifest, so the published crate would not match its lock entry",
                    cargo_lock_path.display(),
                    crate_name,
                    locked_version,
                    new_version
                ));
            }
        } else {
            println!(
                "Warning: {} has no [[package]] entry for `{}`; skipping lock agreement check",
                cargo_lock_path.display(),
                crate_name
            );
        }
    }

    Ok(())
}

#[cfg(test)]
#[path = "version-and-commit/tests.rs"]
mod tests;

#[cfg(not(test))]
fn main() -> std::io::Result<()> {
    let bump_type = match get_arg("bump-type") {
        Some(bt) => bt,
        None => {
            eprintln!("Usage: rust-script scripts/version-and-commit.rs --bump-type <major|minor|patch> [--description <desc>] [--rust-root <path>] [--tag-prefix <prefix>] [--release-label <label>]");
            exit(1);
        }
    };

    if !["major", "minor", "patch"].contains(&bump_type.as_str()) {
        eprintln!(
            "Invalid bump type: {}. Must be major, minor, or patch.",
            bump_type
        );
        exit(1);
    }

    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let description = get_arg("description");
    let tag_prefix = get_arg("tag-prefix")
        .unwrap_or_else(|| release_naming::tag_prefix_for_rust_root(&rust_root).to_string());
    let release_label = get_arg("release-label");
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let changelog_dir = get_changelog_dir(&rust_root);
    let changelog_file = get_changelog_path(&rust_root);

    // Inspect all repository changes before any release write or remote request.
    release_index::ReleaseIndex::new(Path::new(&rust_root), &package_manifest)
        .and_then(|index| index.validate())
        .unwrap_or_else(|e| {
            eprintln!("::error::{e}");
            exit(1);
        });

    // Configure git
    let _ = exec("git", &["config", "user.name", "github-actions[bot]"]);
    let _ = exec(
        "git",
        &[
            "config",
            "user.email",
            "github-actions[bot]@users.noreply.github.com",
        ],
    );

    // Sync with the latest remote state BEFORE touching any files.
    //
    // This must happen while the working tree is clean: `git rebase` refuses to
    // run with a dirty index ("cannot rebase: Your index contains uncommitted
    // changes"). Rebasing after staging the version bump is what previously
    // broke the release job. Rebasing first also means the version bump is
    // computed from the most recent state of the branch (matches the JS
    // version-and-commit.mjs ordering).
    let current_branch =
        exec("git", &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "main".to_string());
    if let Err(e) = exec("git", &["fetch", "origin", &current_branch]) {
        eprintln!("Warning: Could not fetch origin/{}: {}", current_branch, e);
    } else {
        // Count the commits origin/<branch> has that HEAD does not. Being merely
        // ahead of the remote is not being behind, and needs no rebase.
        let behind: u32 = exec(
            "git",
            &[
                "rev-list",
                "--count",
                &format!("HEAD..origin/{}", current_branch),
            ],
        )
        .ok()
        .and_then(|out| out.trim().parse().ok())
        .unwrap_or(0);
        if behind > 0 {
            println!(
                "Local branch is behind origin/{} by {} commit(s), rebasing...",
                current_branch, behind
            );
            if let Err(e) = exec("git", &["rebase", &format!("origin/{}", current_branch)]) {
                eprintln!("Error rebasing onto origin/{}: {}", current_branch, e);
                let _ = exec("git", &["rebase", "--abort"]);
                exit(1);
            }
        }
    }

    // Recompute the allowlist after synchronization, including new fragments.
    let release_index = release_index::ReleaseIndex::new(Path::new(&rust_root), &package_manifest)
        .unwrap_or_else(|e| {
            eprintln!("::error::{e}");
            exit(1);
        });

    // Get current version
    let content = match fs::read_to_string(&package_manifest) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error reading {}: {}", package_manifest.display(), e);
            exit(1);
        }
    };

    let current = match Version::parse(&content) {
        Some(v) => v,
        None => {
            eprintln!(
                "Error: Could not parse version from {}",
                package_manifest.display()
            );
            exit(1);
        }
    };

    let initial_bump = current.bump(&bump_type);

    let crate_name = match get_crate_name(package_manifest.to_string_lossy().as_ref()) {
        Ok(name) => name,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    let max_published = get_max_published_version(&crate_name);
    if let Some((ma, mi, pa)) = max_published {
        println!("Max published version on crates.io: {}.{}.{}", ma, mi, pa);
    } else {
        println!("No versions published on crates.io yet (or crate not found)");
    }

    println!(
        "Initial bump ({}) from {}.{}.{}: {}",
        bump_type, current.major, current.minor, current.patch, initial_bump
    );

    let new_version =
        ensure_version_exceeds_published(&initial_bump, &crate_name, &tag_prefix, max_published);

    if new_version != initial_bump {
        println!(
            "Adjusted version from {} to {} to exceed published versions",
            initial_bump, new_version
        );
    }

    println!("Final release version: {}", new_version);

    // Update version in Cargo.toml
    if let Err(e) = update_cargo_toml(package_manifest.to_string_lossy().as_ref(), &new_version) {
        eprintln!("Error: {}", e);
        exit(1);
    }

    let cargo_lock_path = rust_paths::get_cargo_lock_path(&rust_root);
    let lock_updated = match update_cargo_lock(&cargo_lock_path, &crate_name, &new_version) {
        Ok(updated) => updated,
        Err(e) => {
            eprintln!("Error updating Cargo.lock: {}", e);
            exit(1);
        }
    };

    // Collect changelog fragments
    let fragments_before = count_changelog_fragments(&changelog_dir);
    collect_changelog(&changelog_dir, &changelog_file, &new_version);

    // The release commit is never re-checked by CI, so the write is verified
    // before it is staged (issue #159).
    if let Err(e) = verify_release_write(
        &changelog_file,
        &changelog_dir,
        &cargo_lock_path,
        &crate_name,
        &new_version,
        fragments_before > 0,
    ) {
        eprintln!("::error title=Release write verification failed::{}", e);
        exit(1);
    }

    release_index.validate().unwrap_or_else(|e| {
        eprintln!("::error::{e}");
        exit(1);
    });

    // Stage Cargo.toml, Cargo.lock if changed, CHANGELOG.md, and consumed changelog fragments.
    let package_manifest_str = package_manifest.to_string_lossy().to_string();
    let cargo_lock_str = cargo_lock_path.to_string_lossy().to_string();
    let mut add_args = vec!["add", &package_manifest_str, &changelog_file];
    if lock_updated {
        add_args.push(&cargo_lock_str);
    }
    if let Err(e) = exec("git", &add_args) {
        eprintln!("Error staging release files: {}", e);
        exit(1);
    }
    if Path::new(&changelog_dir).exists() {
        if let Err(e) = exec("git", &["add", "-A", &changelog_dir]) {
            eprintln!("Error staging changelog fragments: {}", e);
            exit(1);
        }
    }

    // Validate the complete index again, including anything staged beforehand.
    release_index.validate().unwrap_or_else(|e| {
        eprintln!("::error::{e}");
        exit(1);
    });

    // Check if there are changes to commit
    if exec_check("git", &["diff", "--cached", "--quiet"]) {
        println!("No changes to commit");
        set_output("version_committed", "false")?;
        set_output("new_version", &new_version)?;
        return Ok(());
    }

    // Commit changes
    let label_suffix = release_label
        .as_ref()
        .map(|l| format!(" ({})", l))
        .unwrap_or_default();
    let commit_msg = match &description {
        Some(desc) => format!(
            "chore: release {}{}{}\n\n{}",
            tag_prefix, new_version, label_suffix, desc
        ),
        None => format!(
            "chore: release {}{}{}",
            tag_prefix, new_version, label_suffix
        ),
    };

    if let Err(e) = exec("git", &["commit", "-m", &commit_msg]) {
        eprintln!("Error committing: {}", e);
        exit(1);
    }
    println!("Committed version {}", new_version);

    // Push changes with retry -- but only a genuine race is retried (issue
    // #162): a lost non-fast-forward is fixed by rebasing onto the new remote
    // tip, while a repository-ruleset refusal or any other failure is reported
    // as what it is instead of being masked as a merge conflict.
    let max_push_attempts = 3;
    for attempt in 1..=max_push_attempts {
        match exec("git", &["push"]) {
            Ok(_) => break,
            Err(push_error) => match classify_push_failure(&push_error) {
                PushFailure::RepositoryRules => {
                    eprintln!(
                        "::error title=Push declined by repository rules::The push to branch '{}' was declined by a repository rule (a GH006/GH013-class rejection, e.g. 'changes must be made through a pull request' or a protected-branch ruleset). Rebasing and retrying cannot change repository policy: release this change through a pull request, or adjust the ruleset so the release bot may push.\n--- git output ---\n{}",
                        current_branch, push_error
                    );
                    exit(1);
                }
                PushFailure::Other => {
                    eprintln!("Error pushing: {}", push_error);
                    exit(1);
                }
                PushFailure::LostRace => {
                    if attempt < max_push_attempts {
                        eprintln!(
                            "Push rejected as non-fast-forward (attempt {}/{}); the remote branch moved. Pulling with rebase and retrying...",
                            attempt, max_push_attempts
                        );
                        if let Err(rebase_err) =
                            exec("git", &["pull", "--rebase", "origin", &current_branch])
                        {
                            eprintln!("Error during pull --rebase: {}", rebase_err);
                            let _ = exec("git", &["rebase", "--abort"]);
                            exit(1);
                        }
                    } else {
                        eprintln!(
                            "Error pushing after {} attempts: {}",
                            max_push_attempts, push_error
                        );
                        exit(1);
                    }
                }
            },
        }
    }

    // Create tag only after the release commit is on the remote, so that a
    // `pull --rebase` retry above can never leave the tag on an orphaned
    // pre-rebase commit (see issue #94).
    let tag_name = format!("{}{}", tag_prefix, new_version);
    let tag_msg = match &description {
        Some(desc) => format!("Release {}{}\n\n{}", tag_name, label_suffix, desc),
        None => format!("Release {}{}", tag_name, label_suffix),
    };

    if let Err(e) = exec("git", &["tag", "-a", &tag_name, "-m", &tag_msg]) {
        eprintln!("Error creating tag: {}", e);
        exit(1);
    }
    println!("Created tag {}", tag_name);

    // Push exactly the release tag: `push --tags` would publish every local
    // tag, including unrelated ones left behind by other jobs or retries.
    if let Err(e) = exec("git", &["push", "origin", &tag_name]) {
        eprintln!("Error pushing tag {}: {}", tag_name, e);
        exit(1);
    }
    println!("Pushed changes and tag {}", tag_name);

    set_output("version_committed", "true")?;
    set_output("new_version", &new_version)?;
    Ok(())
}
