#!/usr/bin/env rust-script
//! Detect code changes for CI/CD pipeline
//!
//! This script detects what types of files have changed in the latest commit
//! and outputs the results for use in GitHub Actions workflow conditions.
//!
//! Key behavior:
//! - For PRs: detects GitHub Actions' synthetic merge commit and uses
//!   HEAD^2^..HEAD^2 to get the per-commit diff of the actual PR head,
//!   so a commit touching only non-code files correctly skips CI jobs
//!   even when earlier commits in the same PR touched code files.
//! - For pushes: compares HEAD against its first parent, including real merge
//!   commits pushed to main
//! - Excludes certain folders and file types from "code changes" detection
//!
//! Excluded from code changes (don't require changelog fragments):
//! - Markdown files (*.md) in any folder
//! - changelog.d/ folder (changelog fragments)
//! - dev/log/ folder (development logs)
//! - docs/ folder (documentation, including case studies)
//! - experiments/ folder (experimental scripts)
//! - examples/ folder (example scripts)
//!
//! Paths are matched relative to the Rust package root, which is detected with
//! scripts/rust-paths.rs. `git diff --name-only` prints repository-root-relative
//! paths, so in a multi-language repository (`rust/Cargo.toml`) the `rust/`
//! prefix is stripped before matching and files of other languages
//! (for example `python/pyproject.toml`) are not treated as Rust changes.
//!
//! Usage: rust-script scripts/detect-code-changes.rs
//!
//! Environment variables (set by GitHub Actions):
//!   - GITHUB_EVENT_NAME: 'pull_request' or 'push'
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - rs-changed: 'true' if any .rs files changed
//!   - toml-changed: 'true' if any .toml files changed
//!   - workflow-changed: 'true' if any .github/workflows/ files changed
//!   - any-code-changed: 'true' if any code files changed (excludes docs, changelog.d, experiments, examples)
//!   - docs-changed: 'true' if any markdown file or docs/ file changed
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use regex::Regex;
use std::env;
#[cfg(test)]
use std::fs;
use std::path::Path;
use std::process::Command;

#[path = "rust-paths.rs"]
mod rust_paths;

fn exec_in(command: &str, args: &[&str], current_dir: Option<&Path>) -> std::io::Result<String> {
    let mut process = Command::new(command);
    process.args(args);
    if let Some(current_dir) = current_dir {
        process.current_dir(current_dir);
    }
    let output = process.output().map_err(|error| {
        std::io::Error::new(
            error.kind(),
            format!("Failed to execute {command} {args:?}: {error}"),
        )
    })?;
    if !output.status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "Error executing {command} {args:?} ({}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

#[path = "github-output.rs"]
mod github_output;

fn set_output(name: &str, value: &str) -> std::io::Result<()> {
    github_output::write_output(name, value)?;
    println!("{name}={value}");
    Ok(())
}

fn commit_parents(repo_path: &Path, revision: &str) -> std::io::Result<Vec<String>> {
    // Inspect the commit's headers independently of its diff. Even a shallow
    // commit records its parent, so unavailable history fails rather than being
    // mistaken for an initial commit. Ignore parent-like lines in the message.
    let output = exec_in("git", &["cat-file", "-p", revision], Some(repo_path))?;
    Ok(output
        .lines()
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.strip_prefix("parent ").map(String::from))
        .collect())
}

fn get_changed_files() -> std::io::Result<Vec<String>> {
    let event_name = env::var("GITHUB_EVENT_NAME").unwrap_or_default();
    get_changed_files_in_repo(Path::new("."), &event_name)
}

fn get_changed_files_in_repo(repo_path: &Path, event_name: &str) -> std::io::Result<Vec<String>> {
    exec_in(
        "git",
        &["rev-parse", "--verify", "HEAD^{commit}"],
        Some(repo_path),
    )?;
    let parents = commit_parents(repo_path, "HEAD")?;
    // Disable rename detection so moving code into an excluded folder still
    // reports the deleted source. Preserve the PR's per-commit diff semantics.
    let output = if event_name == "pull_request" && parents.len() > 1 {
        println!("Merge commit detected (pull_request event)");
        let pr_parents = commit_parents(repo_path, "HEAD^2")?;
        let base = if pr_parents.is_empty() {
            "HEAD^"
        } else {
            "HEAD^2^"
        };
        println!("Comparing {base} to HEAD^2 (per-commit diff of PR head)");
        exec_in(
            "git",
            &["diff", "--name-only", "--no-renames", base, "HEAD^2"],
            Some(repo_path),
        )?
    } else if parents.is_empty() {
        println!("Initial commit, listing all files in HEAD");
        exec_in(
            "git",
            &["ls-tree", "--name-only", "-r", "HEAD"],
            Some(repo_path),
        )?
    } else {
        println!("Comparing HEAD^1 to HEAD");
        exec_in(
            "git",
            &["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"],
            Some(repo_path),
        )?
    };
    // Ok("") is a real empty diff; it must never select a fallback.
    Ok(output
        .lines()
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect())
}

/// Package path prefix relative to the repository root.
///
/// `git diff --name-only` always prints repository-root-relative paths, while
/// the exclusion list below is expressed relative to the Rust package root.
/// In a multi-language repository (`rust/Cargo.toml`) this returns `"rust/"`;
/// in a single-package one it returns `""`.
fn path_prefix() -> String {
    match rust_paths::get_rust_root(None, false) {
        Ok(root) if root != "." && !root.is_empty() => {
            format!("{}/", root.trim_end_matches('/'))
        }
        _ => String::new(),
    }
}

/// Shared folders that belong to no single language and therefore stay in scope
/// even in a multi-language repository.
const SHARED_TOP_LEVEL_FOLDERS: [&str; 2] = [".github/", "scripts/"];

/// Map a repository-root-relative path to a Rust-package-relative one.
///
/// Returns `None` when the file belongs to another language of a
/// multi-language repository (for example `python/pyproject.toml`), so that
/// such a change is not reported as a Rust change.
fn package_relative_path<'a>(prefix: &str, file_path: &'a str) -> Option<&'a str> {
    if prefix.is_empty() {
        return Some(file_path);
    }

    if let Some(relative) = file_path.strip_prefix(prefix) {
        return Some(relative);
    }

    if SHARED_TOP_LEVEL_FOLDERS
        .iter()
        .any(|folder| file_path.starts_with(folder))
    {
        return Some(file_path);
    }

    // Repository-root files (no directory component) stay in scope.
    if !file_path.contains('/') {
        return Some(file_path);
    }

    None
}

fn is_excluded_from_code_changes(prefix: &str, file_path: &str) -> bool {
    // Exclude markdown files in any folder
    if file_path.ends_with(".md") {
        return true;
    }

    // Files of another language in a multi-language repository are not
    // Rust changes.
    let Some(relative) = package_relative_path(prefix, file_path) else {
        return true;
    };

    // Exclude specific folders from code changes
    let excluded_folders = [
        "changelog.d/",
        "dev/log/",
        "docs/",
        "experiments/",
        "examples/",
    ];

    excluded_folders
        .iter()
        .any(|folder| relative.starts_with(folder))
}

fn is_manifest_or_lockfile_change(file_path: &str) -> bool {
    file_path.ends_with(".toml") || file_path.ends_with("Cargo.lock")
}

/// The docs-validation gate keys on exactly what the code-change filters
/// deliberately exclude: markdown anywhere and the docs folder. Computed from
/// the full changed-file list, because `included_changed_files` drops both.
fn is_docs_change(file_path: &str) -> bool {
    file_path.ends_with(".md") || file_path.starts_with("docs/")
}

fn code_change_pattern() -> Regex {
    Regex::new(r"(\.(rs|toml|mjs|js|sh|py|json|yml|yaml)$|(^|/)Cargo\.lock$|^\.github/(workflows|actions)/)").unwrap()
}

fn included_changed_files<'a>(prefix: &str, changed_files: &'a [String]) -> Vec<&'a String> {
    changed_files
        .iter()
        .filter(|file| !is_excluded_from_code_changes(prefix, file))
        .collect()
}

fn main() -> std::io::Result<()> {
    println!("Detecting file changes for CI/CD...\n");

    let changed_files = get_changed_files()?;

    println!("Changed files:");
    if changed_files.is_empty() {
        println!("  (none)");
    } else {
        for file in &changed_files {
            println!("  {}", file);
        }
    }
    println!();

    // Apply the ignore policy once, before computing any job-gating output.
    let prefix = path_prefix();
    if !prefix.is_empty() {
        println!("Multi-language layout detected, Rust package prefix: {prefix}\n");
    }
    let included_files = included_changed_files(&prefix, &changed_files);

    // Detect .rs file changes (Rust source)
    let rs_changed = included_files.iter().any(|f| f.ends_with(".rs"));
    set_output("rs-changed", if rs_changed { "true" } else { "false" })?;

    // Detect manifest/lockfile changes (Cargo.toml, Cargo.lock, etc.)
    let toml_changed = included_files
        .iter()
        .any(|f| is_manifest_or_lockfile_change(f));
    set_output("toml-changed", if toml_changed { "true" } else { "false" })?;

    // Detect workflow changes
    let workflow_changed = included_files
        .iter()
        .any(|f| f.starts_with(".github/workflows/"));
    set_output(
        "workflow-changed",
        if workflow_changed { "true" } else { "false" },
    )?;

    // Detect documentation changes. Deliberately computed from every changed
    // file: the code filters below exclude docs, which is exactly the set the
    // validate-docs job cares about (issue #161).
    let docs_changed = changed_files.iter().any(|f| is_docs_change(f));
    set_output("docs-changed", if docs_changed { "true" } else { "false" })?;

    // Detect code changes (excluding docs, changelog.d, experiments, examples folders, and markdown files)
    println!("\nFiles considered as code changes:");
    if included_files.is_empty() {
        println!("  (none)");
    } else {
        for file in &included_files {
            println!("  {}", file);
        }
    }
    println!();

    // Check if any code files changed (.rs, .toml, Cargo.lock, .mjs, .yml, .yaml, or workflow files)
    let code_pattern = code_change_pattern();
    let code_changed = included_files.iter().any(|f| code_pattern.is_match(f));
    set_output(
        "any-code-changed",
        if code_changed { "true" } else { "false" },
    )?;

    println!("\nChange detection completed.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!("detect-code-changes-{name}-{nanos}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn run_git(repo_path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .unwrap_or_else(|error| panic!("failed to run git {args:?}: {error}"));
        assert!(
            output.status.success(),
            "git {args:?} failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn create_merge_repo() -> PathBuf {
        let parent = temp_dir("merge-repo");
        run_git(&parent, &["init", "-b", "main", "repo"]);

        let repo = parent.join("repo");
        run_git(&repo, &["config", "user.email", "test@example.com"]);
        run_git(&repo, &["config", "user.name", "Test User"]);

        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn value() -> i32 { 1 }\n").unwrap();
        fs::write(repo.join("Cargo.toml"), "[package]\nname = \"example\"\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "Initial commit"]);

        run_git(&repo, &["checkout", "-b", "feature"]);

        fs::write(repo.join("src/lib.rs"), "pub fn value() -> i32 { 2 }\n").unwrap();
        run_git(&repo, &["add", "src/lib.rs"]);
        run_git(&repo, &["commit", "-m", "Change Rust source"]);

        fs::create_dir_all(repo.join("docs")).unwrap();
        fs::write(repo.join("docs/notes.md"), "# Notes\n").unwrap();
        run_git(&repo, &["add", "docs/notes.md"]);
        run_git(&repo, &["commit", "-m", "Add docs notes"]);

        run_git(&repo, &["checkout", "main"]);
        run_git(
            &repo,
            &["merge", "--no-ff", "feature", "-m", "Merge feature"],
        );

        repo
    }

    fn create_single_change_merge_repo(file_path: &str) -> PathBuf {
        let parent = temp_dir("excluded-event-matrix");
        run_git(&parent, &["init", "-b", "main", "repo"]);

        let repo = parent.join("repo");
        run_git(&repo, &["config", "user.email", "test@example.com"]);
        run_git(&repo, &["config", "user.name", "Test User"]);
        fs::write(repo.join("README.md"), "# Test\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "Initial commit"]);
        run_git(&repo, &["checkout", "-b", "feature"]);

        let changed_path = repo.join(file_path);
        fs::create_dir_all(changed_path.parent().unwrap()).unwrap();
        fs::write(&changed_path, "reproduction\n").unwrap();
        run_git(&repo, &["add", file_path]);
        run_git(&repo, &["commit", "-m", "Add excluded reproduction"]);
        run_git(&repo, &["checkout", "main"]);
        run_git(
            &repo,
            &["merge", "--no-ff", "feature", "-m", "Merge feature"],
        );

        repo
    }

    #[test]
    fn successful_empty_commits_do_not_fall_back_to_listing_all_files() {
        let repo = create_merge_repo();
        run_git(&repo, &["checkout", "feature"]);
        run_git(&repo, &["commit", "--allow-empty", "-m", "Empty commit"]);
        assert!(get_changed_files_in_repo(&repo, "push").unwrap().is_empty());
        run_git(&repo, &["checkout", "main"]);
        run_git(
            &repo,
            &["merge", "--no-ff", "feature", "-m", "Merge empty commit"],
        );
        assert!(get_changed_files_in_repo(&repo, "pull_request")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn shell_scripts_and_composite_action_files_are_code() {
        let pattern = code_change_pattern();
        for path in [
            "scripts/simulate-fresh-merge.sh",
            "scripts/test.py",
            ".github/actions/tool/data.txt",
        ] {
            assert!(pattern.is_match(path), "{path}");
            assert!(!is_excluded_from_code_changes("", path));
        }
        for path in [
            "docs/example.sh",
            "changelog.d/example.sh",
            "dev/log/example.sh",
        ] {
            assert!(is_excluded_from_code_changes("", path), "{path}");
        }
    }

    #[test]
    fn cargo_lock_changes_count_as_manifest_and_code_changes() {
        let code_pattern = code_change_pattern();

        for path in ["Cargo.lock", "rust/Cargo.lock"] {
            assert!(is_manifest_or_lockfile_change(path));
            assert!(code_pattern.is_match(path));
            assert!(!is_excluded_from_code_changes("", path));
        }
    }

    /// Docs changes are exactly what the code-change filters exclude, so the
    /// validate-docs gate sees the files no other job would (issue #161).
    #[test]
    fn docs_changes_are_the_complement_of_the_code_filters() {
        for path in [
            "README.md",
            "CONTRIBUTING.md",
            "docs/guide.md",
            "docs/case-studies/issue-109/repro.md",
            "changelog.d/20260908_fix.md",
            "docs/style.css",
        ] {
            assert!(is_docs_change(path), "{path} should be a docs change");
        }

        for path in [
            "src/lib.rs",
            "Cargo.toml",
            ".github/workflows/release.yml",
            "src/data.json",
        ] {
            assert!(!is_docs_change(path), "{path} is not a docs change");
        }
    }

    #[test]
    fn excluded_paths_do_not_activate_any_job_gating_output() {
        let excluded_files = [
            "experiments/repro.rs",
            "experiments/repro.mjs",
            "experiments/repro.md",
            "dev/log/trace.rs",
            "dev/log/trace.mjs",
            "dev/log/trace.md",
            "docs/case-studies/issue-109/repro.rs",
            "docs/case-studies/issue-109/repro.mjs",
            "docs/case-studies/issue-109/repro.md",
        ];

        for file in excluded_files {
            assert!(
                is_excluded_from_code_changes("", file),
                "{file} should be excluded before outputs are computed"
            );
        }
    }

    #[test]
    fn excluded_only_event_matrix_has_no_included_changes() {
        for event_name in ["pull_request", "push"] {
            for file_path in [
                "experiments/repro.mjs",
                "dev/log/repro.rs",
                "docs/case-studies/issue-109/repro.md",
            ] {
                let repo = create_single_change_merge_repo(file_path);
                let changed_files = get_changed_files_in_repo(&repo, event_name).unwrap();

                assert_eq!(changed_files, [file_path]);
                assert!(
                    included_changed_files("", &changed_files).is_empty(),
                    "{event_name} with only {file_path} must not activate job outputs"
                );
            }
        }
    }

    #[test]
    fn multi_language_layout_excludes_prefixed_folders() {
        // Repository-root-relative paths in the rust/Cargo.toml layout.
        for file in [
            "rust/examples/demo.rs",
            "rust/changelog.d/20260101_fix.md",
            "rust/docs/guide.rs",
            "rust/experiments/repro.rs",
            "rust/dev/log/trace.rs",
        ] {
            assert!(
                is_excluded_from_code_changes("rust/", file),
                "{file} should be excluded in the multi-language layout"
            );
        }

        for file in ["rust/src/lib.rs", "rust/Cargo.toml", "rust/Cargo.lock"] {
            assert!(
                !is_excluded_from_code_changes("rust/", file),
                "{file} is a Rust source change and must not be excluded"
            );
        }
    }

    #[test]
    fn multi_language_layout_keeps_shared_and_root_paths_in_scope() {
        for file in [
            ".github/workflows/release.yml",
            "scripts/detect-code-changes.rs",
            "Makefile",
        ] {
            assert_eq!(package_relative_path("rust/", file), Some(file));
            assert!(!is_excluded_from_code_changes("rust/", file));
        }
    }

    #[test]
    fn multi_language_layout_ignores_other_language_changes() {
        for file in [
            "python/pyproject.toml",
            "csharp/src/App.csproj",
            "js/index.js",
        ] {
            assert_eq!(package_relative_path("rust/", file), None);
            assert!(
                is_excluded_from_code_changes("rust/", file),
                "{file} belongs to another language and is not a Rust change"
            );
        }
    }

    #[test]
    fn examples_only_pull_request_activates_no_output_in_multi_language_layout() {
        let repo = create_single_change_merge_repo("rust/examples/demo.rs");
        let changed_files = get_changed_files_in_repo(&repo, "pull_request").unwrap();

        assert_eq!(changed_files, ["rust/examples/demo.rs"]);
        assert!(
            included_changed_files("rust/", &changed_files).is_empty(),
            "an examples-only pull request must not set any-code-changed"
        );
        // Without the prefix (single-package layout) the same path is code.
        assert!(!included_changed_files("", &changed_files).is_empty());
    }

    #[test]
    fn path_prefix_is_empty_in_a_single_package_checkout() {
        // The template itself is a single-package repository (Cargo.toml in root).
        assert_eq!(path_prefix(), "");
    }

    #[test]
    fn push_merge_commit_detects_full_first_parent_merge_diff() {
        let repo = create_merge_repo();

        let changed_files = get_changed_files_in_repo(&repo, "push").unwrap();

        assert!(
            changed_files.iter().any(|file| file == "src/lib.rs"),
            "push merge diff should include the earlier Rust source commit: {changed_files:?}"
        );
        assert!(
            changed_files.iter().any(|file| file == "docs/notes.md"),
            "push merge diff should include the final docs commit: {changed_files:?}"
        );
        assert!(changed_files.iter().any(|file| file.ends_with(".rs")));

        let code_pattern = code_change_pattern();
        let code_changed = changed_files
            .iter()
            .filter(|file| !is_excluded_from_code_changes("", file))
            .any(|file| code_pattern.is_match(file));
        assert!(
            code_changed,
            "real merge pushes that introduce Rust source changes should set any-code-changed"
        );
    }

    #[test]
    fn pull_request_synthetic_merge_uses_latest_pr_head_commit_diff() {
        let repo = create_merge_repo();

        let changed_files = get_changed_files_in_repo(&repo, "pull_request").unwrap();

        assert_eq!(
            changed_files,
            vec!["docs/notes.md"],
            "pull_request synthetic merge detection should keep the per-commit PR head diff"
        );
    }
}
