//! Regression tests for issue #161.
//!
//! Principle 12 asks for three documentation checks; only the link checker
//! existed here. A deleted `CONTRIBUTING.md` or a gutted `README` kept the
//! pipeline green -- the link checker even got greener, because the sections
//! that contained the links were the ones removed. The required-documents
//! half is `scripts/check-required-docs.sh`, wired into the `validate-docs`
//! job; the size-limit half gives `.md` files their own (larger) budget in
//! `scripts/check-file-size.rs`.

#![cfg(not(windows))]

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

fn script_path() -> String {
    format!(
        "{}/scripts/check-required-docs.sh",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn run_script(dir: &Path, args: &[&str]) -> Output {
    Command::new("bash")
        .arg(script_path())
        .args(args)
        .current_dir(dir)
        .output()
        .expect("check-required-docs.sh should run")
}

fn requirement_lines() -> Vec<String> {
    let output = run_script(Path::new("/"), &["--list"]);
    assert!(
        output.status.success(),
        "--list should succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let lines: Vec<String> = String::from_utf8(output.stdout)
        .expect("--list output is utf-8")
        .lines()
        .map(String::from)
        .collect();
    assert!(!lines.is_empty(), "the requirement table must not be empty");
    lines
}

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("issue-161-{name}-{nanos}"));
    fs::create_dir_all(&path).unwrap();
    path
}

/// Build a documentation tree from the requirement table the check itself
/// prints, so these tests exercise the same source of truth the job runs.
fn build_repo_satisfying_the_table(name: &str) -> PathBuf {
    let repo = temp_dir(name);
    for line in requirement_lines() {
        let (path, section) = match line.split_once('\t') {
            Some((path, section)) => (path.to_string(), Some(section.to_string())),
            None => (line.clone(), None),
        };
        let file = repo.join(&path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let mut content = fs::read_to_string(&file).unwrap_or_default();
        let _ = writeln!(content, "# {path}");
        if let Some(section) = section {
            let _ = writeln!(content, "\n## {section}\n\nBody of {section}.");
        }
        fs::write(&file, content).unwrap();
    }
    repo
}

/// The whole point of the check: a repository whose docs match the table
/// passes, so the failure cases below are meaningful.
#[test]
fn a_repository_satisfying_the_script_s_own_table_passes() {
    let repo = build_repo_satisfying_the_table("satisfied");

    let output = run_script(&repo, &[]);
    assert!(
        output.status.success(),
        "a fixture built from --list must pass: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

/// The check is not decoration: gutting a section fails the build and says
/// which document lost what.
#[test]
fn a_removed_section_fails_the_check_by_name() {
    let repo = build_repo_satisfying_the_table("gutted-section");
    let section = requirement_lines()
        .into_iter()
        .find_map(|line| {
            line.split_once('\t')
                .map(|(_, section)| section.to_string())
        })
        .expect("the table should contain at least one sectioned document");

    let readme = repo.join("README.md");
    let gutted = fs::read_to_string(&readme)
        .unwrap()
        .lines()
        .filter(|line| *line != format!("## {section}"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&readme, gutted).unwrap();

    let output = run_script(&repo, &[]);
    assert!(
        !output.status.success(),
        "removing '## {section}' must fail the check"
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains(&section),
        "the failure should name the missing section {section:?}:\n{stdout}"
    );
}

/// A document that exists but is missing every required section is the
/// "emptied the README" half of the issue's reproduction.
#[test]
fn a_deleted_document_fails_the_check_by_name() {
    let repo = build_repo_satisfying_the_table("deleted-doc");
    let bare = requirement_lines()
        .into_iter()
        .find(|line| !line.contains('\t'))
        .expect("the table should contain at least one existence-only requirement");

    fs::remove_file(repo.join(&bare)).unwrap();

    let output = run_script(&repo, &[]);
    assert!(
        !output.status.success(),
        "deleting {bare} must fail the check"
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains(&bare),
        "the failure should name the deleted document {bare:?}:\n{stdout}"
    );
}

/// Prose that mentions the words does not count: a table-of-contents entry is
/// not the section it links to.
#[test]
fn prose_mentioning_a_section_is_not_the_section() {
    let repo = build_repo_satisfying_the_table("prose-only");
    let (path, section) = requirement_lines()
        .into_iter()
        .find_map(|line| {
            line.split_once('\t')
                .map(|(p, s)| (p.to_string(), s.to_string()))
        })
        .expect("the table should contain at least one sectioned document");

    fs::write(
        repo.join(&path),
        format!(
            "# {path}\n\nThis document talks about the {section} section, and a \
             table of contents lists [\"{section}\"](#{}), but no heading is here.\n",
            section.to_lowercase().replace(' ', "-")
        ),
    )
    .unwrap();

    let output = run_script(&repo, &[]);
    assert!(
        !output.status.success(),
        "prose mentioning {section:?} must not satisfy the heading requirement"
    );
}

/// The template's own documentation must satisfy the table it ships.
#[test]
fn the_template_s_own_documentation_passes_the_check() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"));
    let output = run_script(repo, &[]);
    assert!(
        output.status.success(),
        "the repository's own docs must satisfy its requirement table:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
}

/// The job exists, is gated on the docs-changed output, and observes a sane
/// timeout -- and the gate observes it, so a cancelled docs check is still
/// reported on the default branch.
#[test]
fn release_yml_runs_the_check_from_the_detect_changes_output() {
    let workflow = fs::read_to_string(format!(
        "{}/.github/workflows/release.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("release.yml should exist")
    .replace("\r\n", "\n");

    let job = workflow
        .split("  validate-docs:")
        .nth(1)
        .expect("release.yml must declare a validate-docs job (issue #161)");

    for required in [
        "needs: [javascript-first, detect-changes]",
        "needs.detect-changes.outputs.docs-changed == 'true'",
        "timeout-minutes: 5",
        "persist-credentials: false",
        "bash scripts/check-required-docs.sh",
    ] {
        assert!(
            job.contains(required),
            "validate-docs is missing {required:?}"
        );
    }

    let gate = workflow
        .split("  pipeline-status:")
        .nth(1)
        .expect("release.yml must keep its pipeline-status gate");
    assert!(
        gate.contains("- validate-docs"),
        "pipeline-status must observe validate-docs: a cancelled documentation \
         check would otherwise not be reported on the default branch"
    );

    let outputs = workflow
        .split("  detect-changes:")
        .nth(1)
        .and_then(|job| job.split("  validate-docs:").next())
        .expect("detect-changes should precede validate-docs");
    assert!(
        outputs.contains("docs-changed: ${{ steps.changes.outputs.docs-changed }}"),
        "detect-changes must surface the docs-changed output the job gates on"
    );
}

/// The size-limit half of principle 12: `.md` files are measured, and against
/// their own larger budget rather than the source limit.
#[test]
fn check_file_size_measures_markdown_against_a_docs_budget() {
    let source = fs::read_to_string(format!(
        "{}/scripts/check-file-size.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("check-file-size.rs should exist");

    assert!(
        source.contains(r#"const FILE_EXTENSIONS: &[&str] = &[".rs", ".md"];"#),
        ".md files must be size-checked; before issue #161 they had no limit at all"
    );
    assert!(
        source.contains("const MAX_DOC_LINES: usize = 2500;"),
        "documentation gets its own 2500-line budget, the number principle 12 names"
    );
    assert!(
        source.contains("fn limits_for(file: &str)"),
        "the docs budget must be selected per file, not globally"
    );
}
