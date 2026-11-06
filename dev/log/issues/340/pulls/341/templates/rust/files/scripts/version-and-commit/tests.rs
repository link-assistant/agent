use super::{
    classify_push_failure, collect_changelog_with_date, count_changelog_fragments,
    update_cargo_lock, verify_release_write, PushFailure,
};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("version-and-commit-{name}-{nanos}"));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn cargo_lock_update_scopes_to_named_package_entry() {
    let repo = temp_dir("lock-update");
    let cargo_lock = repo.join("Cargo.lock");
    fs::write(
        &cargo_lock,
        r#"[[package]]
name = "example-sum-package-name-helper"
version = "9.9.9"

[[package]]
name = "example-sum-package-name"
version = "0.13.0"
dependencies = [
 "clap",
]

[[package]]
name = "regex"
version = "1.12.3"
"#,
    )
    .unwrap();

    assert!(update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());

    let updated = fs::read_to_string(&cargo_lock).unwrap();
    assert!(updated.contains("name = \"example-sum-package-name\"\nversion = \"0.14.0\""));
    assert!(updated.contains("name = \"example-sum-package-name-helper\"\nversion = \"9.9.9\""));
    assert!(updated.contains("name = \"regex\"\nversion = \"1.12.3\""));
}

#[test]
fn cargo_lock_update_is_idempotent_when_version_already_matches() {
    let repo = temp_dir("lock-idempotent");
    let cargo_lock = repo.join("Cargo.lock");
    let content = r#"[[package]]
name = "example-sum-package-name"
version = "0.14.0"
"#;
    fs::write(&cargo_lock, content).unwrap();

    assert!(!update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());
    assert_eq!(fs::read_to_string(&cargo_lock).unwrap(), content);
}

#[test]
fn cargo_lock_update_returns_false_when_lock_file_is_absent() {
    let repo = temp_dir("lock-absent");
    let cargo_lock = repo.join("Cargo.lock");

    assert!(!update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());
    assert!(!cargo_lock.exists());
}

#[test]
fn cargo_lock_update_returns_false_when_package_entry_is_absent() {
    let repo = temp_dir("lock-entry-absent");
    let cargo_lock = repo.join("Cargo.lock");
    let content = r#"[[package]]
name = "regex"
version = "1.12.3"
"#;
    fs::write(&cargo_lock, content).unwrap();

    assert!(!update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());
    assert_eq!(fs::read_to_string(&cargo_lock).unwrap(), content);
}

#[test]
fn changelog_collection_removes_consumed_fragments_and_keeps_readme() {
    let repo = temp_dir("changelog-cleanup");
    let changelog_dir = repo.join("changelog.d");
    fs::create_dir_all(&changelog_dir).unwrap();

    let first_fragment = changelog_dir.join("20260608_fix_release_loop.md");
    let second_fragment = changelog_dir.join("20260608_note_release_loop.md");
    fs::write(
        &first_fragment,
        r#"---
bump: patch
---

### Fixed
- Prevent already-collected changelog fragments from triggering another release.
"#,
    )
    .unwrap();
    fs::write(
        &second_fragment,
        r#"### Changed
- Keep release commits from leaving stale changelog fragments behind.
"#,
    )
    .unwrap();
    fs::write(changelog_dir.join("README.md"), "Fragment instructions\n").unwrap();

    let changelog = repo.join("CHANGELOG.md");
    fs::write(
        &changelog,
        r#"# Changelog

## [0.1.0] - 2026-01-01

### Added
- Initial release
"#,
    )
    .unwrap();

    collect_changelog_with_date(
        changelog_dir.to_str().unwrap(),
        changelog.to_str().unwrap(),
        "0.2.0",
        "2026-06-08",
    );

    let updated = fs::read_to_string(&changelog).unwrap();
    assert!(updated.contains("## [0.2.0] - 2026-06-08"));
    assert!(updated.contains("Prevent already-collected changelog fragments"));
    assert!(updated.contains("Keep release commits from leaving stale changelog fragments"));
    assert!(!updated.contains("bump: patch"));
    assert!(!first_fragment.exists());
    assert!(!second_fragment.exists());
    assert!(changelog_dir.join("README.md").exists());
}

/// Regression test for issue #67: the Rust release job failed with
/// "cannot rebase: Your index contains uncommitted changes." because the
/// script staged the version bump (`git add`) and only afterwards ran
/// `git rebase origin/<branch>`. `git rebase` refuses to run with a dirty
/// index, so the release must rebase onto the remote BEFORE staging.
///
/// This test reproduces both orderings against a real temporary repository
/// and asserts the buggy order fails while the fixed order succeeds.
#[test]
fn rebase_must_run_before_staging_the_version_bump() {
    let repo = temp_dir("rebase-order");
    let git = |args: &[&str]| -> std::process::Output {
        Command::new("git")
            .args(args)
            .current_dir(&repo)
            .output()
            .expect("failed to run git")
    };

    // Some CI images default to `master`; force the initial branch to main.
    git(&["init", "-q", "."]);
    git(&["checkout", "-q", "-b", "main"]);
    git(&["config", "user.email", "ci@example.com"]);
    git(&["config", "user.name", "ci"]);

    // Commit A: the state the release job checks out.
    fs::write(repo.join("Cargo.toml"), "version = \"0.1.0\"\n").unwrap();
    git(&["add", "Cargo.toml"]);
    git(&["commit", "-qm", "A: initial"]);

    // Commit B on a parallel ref simulates origin/main advancing while the
    // release job was running (e.g. a concurrent release pushed to main).
    git(&["checkout", "-q", "-b", "upstream"]);
    fs::write(repo.join("remote.txt"), "remote change\n").unwrap();
    git(&["add", "remote.txt"]);
    git(&["commit", "-qm", "B: remote advanced"]);
    git(&["checkout", "-q", "main"]);

    // BUGGY ORDER: stage the bump first, then rebase -> git rejects the
    // dirty index. This is exactly what broke the release job.
    fs::write(repo.join("Cargo.toml"), "version = \"0.1.1\"\n").unwrap();
    git(&["add", "Cargo.toml"]);
    let buggy = git(&["rebase", "upstream"]);
    assert!(
        !buggy.status.success(),
        "rebase unexpectedly succeeded with a dirty index"
    );
    let buggy_err = String::from_utf8_lossy(&buggy.stderr);
    assert!(
        buggy_err.contains("cannot rebase") || buggy_err.contains("uncommitted changes"),
        "unexpected rebase error: {buggy_err}"
    );

    // Reset back to a clean tree at commit A.
    let _ = git(&["rebase", "--abort"]);
    git(&["reset", "-q", "--hard", "HEAD"]);

    // FIXED ORDER: rebase while the tree is clean, THEN stage and commit.
    let fixed = git(&["rebase", "upstream"]);
    assert!(
        fixed.status.success(),
        "rebase with a clean tree failed: {}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    fs::write(repo.join("Cargo.toml"), "version = \"0.1.1\"\n").unwrap();
    git(&["add", "Cargo.toml"]);
    let commit = git(&["commit", "-qm", "chore: release 0.1.1"]);
    assert!(
        commit.status.success(),
        "commit after clean rebase failed: {}",
        String::from_utf8_lossy(&commit.stderr)
    );

    // The bump rides on top of the upstream commit, proving no work was lost.
    let log = git(&["log", "--oneline"]);
    let log_out = String::from_utf8_lossy(&log.stdout);
    assert!(log_out.contains("release 0.1.1"));
    assert!(log_out.contains("B: remote advanced"));
}

// --- issue #162: classify push failures before retrying -------------------

#[test]
fn repository_rules_are_classified_before_the_rebase_retry() {
    // A ruleset rejection also contains the word "rejected"; policy must
    // win over the retry heuristic.
    let ruleset = concat!(
        "Command `git` failed.\n",
        "stdout: To github.com:org/repo.git\n",
        "stderr: ! [remote rejected] main -> main (GH006: Protected branch update failed)\n",
        "error: GH013: Repository rule violations found for refs/heads/main.\n",
        "The push was rejected because changes must be made through a pull request.\n"
    );
    assert_eq!(
        classify_push_failure(ruleset),
        PushFailure::RepositoryRules,
        "a ruleset refusal must never be treated as a rebaseable race"
    );

    let lowercase_rules = "remote: error: push declined due to repository rule violations";
    assert_eq!(
        classify_push_failure(lowercase_rules),
        PushFailure::RepositoryRules
    );
}

#[test]
fn a_lost_race_is_classified_for_the_rebase_retry() {
    let raced = concat!(
        "Command `git` failed.\n",
        "stderr: To github.com:org/repo.git\n",
        " ! [rejected]        main -> main (fetch first)\n",
        "error: failed to push some refs to 'github.com:org/repo.git'\n",
        "hint: Updates were rejected because the remote contains work that you do not have locally.\n"
    );
    assert_eq!(classify_push_failure(raced), PushFailure::LostRace);
}

#[test]
fn an_unknown_push_failure_is_not_masked_as_a_race() {
    for real_error in [
        "ssh: connect to host github.com port 22: Connection timed out",
        "fatal: unable to access 'https://github.com/': Could not resolve host: github.com",
        "fatal: Authentication failed for 'https://github.com/org/repo.git/'",
    ] {
        assert_eq!(
            classify_push_failure(&format!("Command `git` failed.\nstderr: {real_error}")),
            PushFailure::Other,
            "{real_error} must surface as a real error, not trigger a rebase"
        );
    }
}

// --- issue #159: verify the release write before committing ---------------

fn write_changelog(repo: &std::path::Path, body: &str) {
    fs::write(repo.join("CHANGELOG.md"), body).unwrap();
}

/// The verification paths must be anchored inside the temporary repo --
/// relative paths would silently read the real repository's CHANGELOG.md.
fn anchored(repo: &std::path::Path) -> (String, String, PathBuf) {
    (
        repo.join("CHANGELOG.md").to_string_lossy().to_string(),
        repo.join("changelog.d").to_string_lossy().to_string(),
        repo.join("Cargo.lock"),
    )
}

#[test]
fn verification_accepts_a_consistent_release_write() {
    let repo = temp_dir("verify-ok");
    fs::create_dir_all(repo.join("changelog.d")).unwrap();
    write_changelog(
        &repo,
        "# Changelog\n\n## [0.2.0] - 2026-09-09\n\n### Fixed\n\n- something\n",
    );
    fs::write(
        repo.join("Cargo.lock"),
        "[[package]]\nname = \"crate\"\nversion = \"0.2.0\"\n",
    )
    .unwrap();
    let (changelog, dir, lock) = anchored(&repo);

    verify_release_write(&changelog, &dir, &lock, "crate", "0.2.0", true)
        .unwrap_or_else(|error| panic!("consistent write should verify: {error}"));
}

#[test]
fn verification_requires_the_changelog_entry_only_when_fragments_were_collected() {
    let repo = temp_dir("verify-optional-entry");
    fs::create_dir_all(repo.join("changelog.d")).unwrap();
    // A version-only release (docs-only changes) legitimately collects no
    // fragments, so the changelog gains no entry.
    write_changelog(&repo, "# Changelog\n\n## [0.1.0] - 2026-01-01\n");
    let (changelog, dir, lock) = anchored(&repo);

    verify_release_write(&changelog, &dir, &lock, "crate", "0.2.0", false)
        .unwrap_or_else(|error| panic!("fragment-free release should verify: {error}"));

    // The same state with fragments collected must fail: the entry is missing.
    let error = verify_release_write(&changelog, &dir, &lock, "crate", "0.2.0", true).unwrap_err();
    assert!(
        error.contains("0.2.0"),
        "the failure must name the missing version entry, got: {error}"
    );
}

#[test]
fn verification_fails_when_a_fragment_leaks_past_the_release() {
    let repo = temp_dir("verify-leftover");
    fs::create_dir_all(repo.join("changelog.d")).unwrap();
    write_changelog(&repo, "# Changelog\n\n## [0.2.0] - 2026-09-09\n");
    fs::write(
        repo.join("changelog.d/20260909_unconsumed.md"),
        "leftover\n",
    )
    .unwrap();
    let (changelog, dir, lock) = anchored(&repo);

    let error = verify_release_write(&changelog, &dir, &lock, "crate", "0.2.0", true).unwrap_err();
    assert!(
        error.contains("20260909_unconsumed.md"),
        "the failure must name the leaked fragment, got: {error}"
    );
}

#[test]
fn collection_rejects_unreadable_fragments_before_mutation() {
    let repo = temp_dir("unreadable-fragment");
    let dir = repo.join("changelog.d");
    fs::create_dir_all(dir.join("broken.md")).unwrap();
    fs::write(dir.join("good.md"), "### Fixed\n- Keep this fragment.\n").unwrap();
    let changelog = repo.join("CHANGELOG.md");
    fs::write(&changelog, "# Changelog\n").unwrap();
    let result = std::panic::catch_unwind(|| {
        collect_changelog_with_date(
            dir.to_str().unwrap(),
            changelog.to_str().unwrap(),
            "1.0.0",
            "2026-10-10",
        );
    });
    assert!(result.is_err(), "unreadable fragment must be fatal");
    assert_eq!(fs::read_to_string(changelog).unwrap(), "# Changelog\n");
    assert!(dir.join("good.md").is_file());
    fs::remove_dir_all(repo).unwrap();
}

#[test]
fn counting_and_verification_reject_fragment_directory_read_errors() {
    let repo = temp_dir("unreadable-directory");
    fs::write(repo.join("changelog.d"), "not a directory").unwrap();
    let (changelog, dir, lock) = anchored(&repo);
    assert!(std::panic::catch_unwind(|| count_changelog_fragments(&dir)).is_err());
    let error = verify_release_write(&changelog, &dir, &lock, "crate", "1.0.0", false).unwrap_err();
    assert!(error.contains("changelog.d"));
    fs::remove_dir_all(repo).unwrap();
}

#[test]
fn verification_fails_when_the_lock_disagrees_with_the_manifest() {
    let repo = temp_dir("verify-lock");
    fs::create_dir_all(repo.join("changelog.d")).unwrap();
    write_changelog(&repo, "# Changelog\n\n## [0.2.0] - 2026-09-09\n");
    fs::write(
        repo.join("Cargo.lock"),
        "[[package]]\nname = \"crate\"\nversion = \"0.1.9\"\n",
    )
    .unwrap();
    let (changelog, dir, lock) = anchored(&repo);

    let error = verify_release_write(&changelog, &dir, &lock, "crate", "0.2.0", true).unwrap_err();
    assert!(
        error.contains("Cargo.lock verification failed") && error.contains("0.1.9"),
        "the failure must show the disagreement, got: {error}"
    );
}

#[test]
fn fragment_counting_ignores_the_readme() {
    let repo = temp_dir("count-fragments");
    let dir = repo.join("changelog.d");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("README.md"), "explanatory\n").unwrap();
    assert_eq!(count_changelog_fragments(dir.to_str().unwrap()), 0);
    fs::write(dir.join("20260909_a.md"), "a\n").unwrap();
    fs::write(dir.join("20260909_b.md"), "b\n").unwrap();
    assert_eq!(count_changelog_fragments(dir.to_str().unwrap()), 2);
}

#[test]
fn collection_and_verification_ignore_fenced_release_headings() {
    let repo = temp_dir("fenced-release");
    let dir = repo.join("changelog.d");
    fs::create_dir(&dir).unwrap();
    let prefix = "# Changelog\r\n\r\n```md\r\n## [0.2.0] - 2026-09-09\r\n```\r\n\r\n";
    let previous = "## [0.1.0]\r\n  Previous notes.\r\n";
    let changelog = repo.join("CHANGELOG.md");
    fs::write(&changelog, format!("{prefix}{previous}")).unwrap();
    assert!(verify_release_write(
        changelog.to_str().unwrap(),
        dir.to_str().unwrap(),
        &repo.join("Cargo.lock"),
        "crate",
        "0.2.0",
        true
    )
    .is_err());
    fs::write(dir.join("fix.md"), "### Fixed\n- New notes").unwrap();
    collect_changelog_with_date(
        dir.to_str().unwrap(),
        changelog.to_str().unwrap(),
        "0.2.0",
        "2026-09-09",
    );
    let content = fs::read_to_string(&changelog).unwrap();
    assert!(content.starts_with(prefix));
    assert!(content.ends_with(previous));
    verify_release_write(
        changelog.to_str().unwrap(),
        dir.to_str().unwrap(),
        &repo.join("Cargo.lock"),
        "crate",
        "0.2.0",
        true,
    )
    .unwrap();
    fs::remove_dir_all(repo).unwrap();
}
