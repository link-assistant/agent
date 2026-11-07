use regex::Regex;
use std::{fs, path::PathBuf};

fn release_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/release.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    .replace("\r\n", "\n")
}

fn security_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/security.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("security workflow should exist")
    .replace("\r\n", "\n")
}

fn links_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/links.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("broken-link workflow should exist")
    .replace("\r\n", "\n")
}

fn workflow_files() -> Vec<PathBuf> {
    let workflow_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".github/workflows");
    let mut paths = fs::read_dir(workflow_dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("yml" | "yaml")
            )
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn run_blocks(workflow: &str) -> Vec<String> {
    let lines = workflow.lines().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index];
        let indentation = line.len() - line.trim_start().len();
        if !line.trim_start().starts_with("run:") {
            index += 1;
            continue;
        }

        let mut block = vec![line];
        index += 1;
        while index < lines.len() {
            let next = lines[index];
            let next_indentation = next.len() - next.trim_start().len();
            if !next.trim().is_empty() && next_indentation <= indentation {
                break;
            }
            block.push(next);
            index += 1;
        }
        blocks.push(block.join("\n"));
    }

    blocks
}

fn job_block<'a>(workflow: &'a str, job_name: &str) -> &'a str {
    let marker = format!("  {job_name}:\n");
    let start = workflow.find(&marker).unwrap();
    let body_start = start + marker.len();
    let rest = &workflow[body_start..];

    let next_job = rest
        .lines()
        .scan(0usize, |offset, line| {
            let current_offset = *offset;
            *offset += line.len() + 1;
            Some((current_offset, line))
        })
        .find_map(|(offset, line)| {
            let starts_at_job_indent = line.starts_with("  ") && !line.starts_with("    ");
            (starts_at_job_indent && line.trim_end().ends_with(':')).then_some(offset)
        });

    next_job.map_or_else(
        || &workflow[start..],
        |end| &workflow[start..body_start + end],
    )
}

/// Regression test for issue #111:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/111>
///
/// GitHub expands expressions in `run:` into a temporary shell script before executing it.
/// User-controlled contexts must cross that boundary through an environment variable instead.
#[test]
fn workflow_run_blocks_do_not_interpolate_untrusted_contexts() {
    let untrusted_expression =
        Regex::new(r"\$\{\{\s*(?:inputs\.|github\.event\.inputs\.|github\.head_ref)[^}]*\}\}")
            .unwrap();

    for path in workflow_files() {
        let workflow = fs::read_to_string(&path).unwrap().replace("\r\n", "\n");
        for run_block in run_blocks(&workflow) {
            assert!(
                !untrusted_expression.is_match(&run_block),
                "{} interpolates an untrusted context directly into a run block:\n{run_block}",
                path.display()
            );
        }
    }
}

/// Write-capable jobs share a non-cancelling concurrency group, while superseded
/// read-only checks are cancelled independently outside main. Main checks must not
/// be cancelled, or the terminal status gate cannot distinguish them from timeouts.
///
/// Regression test for issue #113:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/113>
///
/// GitHub Actions concurrency accepts only `group` and `cancel-in-progress`.
#[test]
fn release_workflow_separates_check_and_write_concurrency() {
    let workflow = release_workflow();
    let workflow_header = workflow.split("\njobs:\n").next().unwrap();
    assert!(
        !workflow_header.contains("\nconcurrency:\n"),
        "workflow-level concurrency would couple cancellable checks to non-cancellable writes"
    );

    for job_name in [
        "detect-changes",
        "changelog",
        "version-check",
        "secrets-scan",
        "fresh-merge",
        "docker-build",
        "cargo-lock",
        "lint",
        "coverage",
        "build",
    ] {
        let job = job_block(&workflow, job_name);
        let expected_group =
            format!("group: ${{{{ github.workflow }}}}-${{{{ github.ref }}}}-{job_name}");
        assert!(
            job.contains(&expected_group)
                && job.contains("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"),
            "read-only job {job_name} should cancel superseded instances only off main"
        );
    }

    let test = job_block(&workflow, "test");
    assert!(
        test.contains("group: ${{ github.workflow }}-${{ github.ref }}-test-${{ matrix.os }}")
            && test.contains("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"),
        "each test matrix lane should cancel only its own superseded instance off main"
    );

    let write_concurrency = concat!(
        "    concurrency:\n",
        "      group: main-writer-${{ github.repository }}\n",
        "      cancel-in-progress: false\n",
        "      queue: max\n",
    );
    for job_name in [
        "auto-release",
        "manual-release",
        "changelog-pr",
        "deploy-docs",
    ] {
        assert!(
            job_block(&workflow, job_name).contains(write_concurrency),
            "write-capable job {job_name} should use the shared non-cancelling concurrency group"
        );
    }

    assert_eq!(
        workflow.matches("queue: max").count(),
        6,
        "every repository or registry writer must queue instead of replacing pending work"
    );
}

/// Regression test for issue #115:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/115>
#[test]
fn security_workflow_scans_rust_actions_and_pull_request_dependencies() {
    let workflow = security_workflow();
    let header = workflow.split("\njobs:\n").next().unwrap();

    assert!(header.contains("branches: [main]"));
    assert!(header.contains("pull_request:"));
    assert!(header.contains("schedule:"));
    assert!(header.contains("cron: '0 6 * * 1'"));
    assert!(header.contains("permissions:\n  contents: read"));

    let codeql = job_block(&workflow, "codeql");
    assert!(codeql.contains("timeout-minutes: 30"));
    assert!(codeql.contains("security-events: write"));
    assert!(codeql.contains("language: [rust, actions]"));
    assert!(codeql.contains("uses: github/codeql-action/init@v4"));
    assert!(codeql.contains("languages: ${{ matrix.language }}"));
    assert!(codeql.contains("build-mode: none"));
    assert!(codeql.contains("config-file: ./.github/codeql/codeql-config.yml"));
    assert!(codeql.contains("uses: github/codeql-action/analyze@v4"));

    let dependency_review = job_block(&workflow, "dependency-review");
    assert!(dependency_review.contains("if: github.event_name == 'pull_request'"));
    assert!(dependency_review.contains("timeout-minutes: 10"));
    assert!(dependency_review.contains("pull-requests: write"));
    assert!(dependency_review.contains("uses: actions/dependency-review-action@v5"));
    assert!(dependency_review.contains("fail-on-severity: high"));
    assert!(dependency_review.contains("comment-summary-in-pr: on-failure"));
}

/// Regression test for issue #132:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/132>
///
/// Dependency review only examines changes introduced by a pull request. A separate
/// audit of the committed lockfile is required so advisories published after a
/// dependency was merged also fail pushes and scheduled security runs.
#[test]
fn security_workflow_audits_the_committed_cargo_lock() {
    let workflow = security_workflow();
    let header = workflow.split("\njobs:\n").next().unwrap();
    let audit = job_block(&workflow, "cargo-audit");

    assert!(header.contains("push:\n    branches: [main]"));
    assert!(header.contains("pull_request:"));
    assert!(header.contains("schedule:"));
    assert!(audit.contains("name: Cargo audit"));
    assert!(audit.contains("timeout-minutes: 10"));
    assert!(audit.contains("uses: actions/checkout@v7"));
    assert!(audit.contains("tool: cargo-audit@0.22.2"));
    assert!(
        audit.contains("run: cargo audit --file Cargo.lock --deny warnings"),
        "`unmaintained`, `unsound` and `yanked` findings are warnings that do \
         not move cargo-audit's exit status; without --deny warnings a yanked \
         release ships with a green audit (issue #164)"
    );
    assert!(
        !audit.contains("if: github.event_name == 'pull_request'"),
        "the lockfile audit must also run on pushes and scheduled events"
    );
}

/// Regression test for issue #116:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/116>
#[test]
fn links_workflow_checks_documentation_with_archive_fallback() {
    let workflow = links_workflow();
    let header = workflow.split("\njobs:\n").next().unwrap();

    assert!(header.contains("'**.md'"));
    assert!(header.contains("'**.html'"));
    assert!(header.contains("'.github/workflows/links.yml'"));
    assert!(header.contains("'.lycheeignore'"));
    assert!(header.contains("'scripts/check-web-archive.mjs'"));
    assert!(header.contains("'scripts/check-web-archive.test.mjs'"));
    assert!(header.contains("'scripts/recheck-broken-links.mjs'"));
    assert!(header.contains("'scripts/recheck-broken-links.test.mjs'"));
    assert!(header.contains("permissions:\n  contents: read"));

    let link_checker = job_block(&workflow, "link-checker");
    assert!(link_checker.contains("timeout-minutes: 10"));
    assert!(link_checker.contains("cancel-in-progress: true"));
    assert!(link_checker.contains("uses: lycheeverse/lychee-action@v2"));
    assert!(link_checker.contains("node --test scripts/check-web-archive.test.mjs"));
    assert!(link_checker.contains("node --test scripts/recheck-broken-links.test.mjs"));
    assert!(link_checker.contains("--exclude-path docs/case-studies"));
    assert!(!link_checker.contains("examples/universal-app/index.html"));
    assert!(link_checker.contains("fail: false"));
    assert!(link_checker.contains("output: lychee/out.md"));
    assert!(link_checker.contains("node scripts/check-web-archive.mjs"));
    assert!(link_checker.contains("steps.lychee.outputs.exit_code != 0"));

    let archive_helper = fs::read_to_string(format!(
        "{}/scripts/check-web-archive.mjs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("Wayback Machine fallback helper should exist");
    assert!(archive_helper.contains("https://archive.org/wayback/available?url="));
    assert!(archive_helper.contains("setOutput('all_archived'"));

    let ignored_links = fs::read_to_string(format!("{}/.lycheeignore", env!("CARGO_MANIFEST_DIR")))
        .expect("lychee ignore file should exist");
    assert!(ignored_links.contains("https://docs\\.rs/example-sum-package-name"));
}

/// Regression test for issue #125:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/125>
/// and issue #168:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/168>
///
/// An available archive is replacement guidance; it does not repair the broken
/// live link in the repository, so every nonzero Lychee result must fail the
/// job. The one exception is the re-check (#168): a link that never answered
/// lychee but answers the re-check is not broken. The `!= 'true'` form is
/// load-bearing -- a skipped re-check leaves the output empty, and only the
/// `!=` comparison fails safe.
#[test]
fn links_workflow_fails_for_every_broken_live_link() {
    let workflow = links_workflow();
    let link_checker = job_block(&workflow, "link-checker");

    let fail_step = step_block(link_checker, "Fail if broken links were found");
    assert!(fail_step.contains("always() &&"));
    assert!(fail_step.contains("steps.lychee.outputs.exit_code != 0"));
    assert!(
        fail_step.contains("steps.recheck.outputs.all_recovered != 'true'"),
        "the re-check verdict must gate the failure step"
    );
    assert!(
        !workflow.contains("all_recovered == 'false'"),
        "an empty output (skipped re-check) must keep failing the run"
    );

    let archive_step = step_block(link_checker, "Check broken links against Web Archive");
    assert!(archive_step.contains("steps.lychee.outputs.exit_code != 0"));
    assert!(archive_step.contains("steps.recheck.outputs.all_recovered != 'true'"));
    assert!(
        archive_step.contains("RECOVERED_URLS: lychee/recovered.txt"),
        "the Wayback lookup must skip the URLs the re-check recovered"
    );
}

fn step_block<'a>(job: &'a str, step_name: &str) -> &'a str {
    let marker = format!("- name: {step_name}\n");
    let start = job
        .find(&marker)
        .unwrap_or_else(|| panic!("step {step_name:?} should exist"));
    let rest = &job[start + marker.len()..];
    let end = rest.find("\n      - name: ").unwrap_or(rest.len());
    &rest[..end]
}
