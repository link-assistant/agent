use super::workflow_release::{job_block, release_workflow, step_block, workflow_job_names};
use std::fs;

/// Regression test for issue #100 (1):
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/100>
///
/// `always()` runs a job even when the workflow run is cancelled, which is the exact
/// opposite of what `!cancelled()` expresses. Combining them makes `!cancelled()` dead
/// weight while reading as if cancellation still stopped the job. The terminal status
/// observer also uses `!cancelled()`: it sees individual cancelled dependencies, but
/// does not repaint a whole workflow run that a user or concurrency policy cancelled.

#[test]
fn release_workflow_never_combines_always_with_not_cancelled() {
    let workflow = release_workflow();

    assert_eq!(
        workflow.matches("always() && !cancelled()").count(),
        0,
        "always() && !cancelled() is self-contradictory; use !cancelled() alone"
    );
    assert_eq!(
        workflow.matches("always()").count(),
        0,
        "the terminal observer must not run after a whole-run cancellation"
    );
    assert!(job_block(&workflow, "pipeline-status").contains("if: ${{ !cancelled() }}"));
    assert!(
        workflow.contains("!cancelled()"),
        "conditional jobs should still be guarded by !cancelled()"
    );
    // A bare leading `!` is a YAML tag indicator, so single-line guards must be wrapped
    // in `${{ }}` (block scalars `if: |` are fine).
    assert!(
        !workflow.contains("if: !cancelled()"),
        "single-line !cancelled() guards must be wrapped in ${{ }} to stay valid YAML"
    );
}

/// Regression test for issue #118: every job must feed the terminal observer, or a
/// timeout in an omitted job can still leave the workflow with a grey cancelled result.
#[test]
fn pipeline_status_gate_covers_every_other_job() {
    let workflow = release_workflow();
    let job_names = workflow_job_names(&workflow);
    let gate = job_block(&workflow, "pipeline-status");

    assert_eq!(job_names.last(), Some(&"pipeline-status"));
    assert!(gate.contains("bash scripts/check-pipeline-status.sh"));
    assert!(gate.contains("NEEDS_JSON: ${{ toJSON(needs) }}"));
    assert!(gate.contains("github.ref == 'refs/heads/main' && github.event_name == 'push'"));

    let needs = gate
        .split("needs:")
        .nth(1)
        .expect("pipeline-status should declare needs")
        .split("steps:")
        .next()
        .expect("pipeline-status needs block");
    for job_name in job_names {
        if job_name != "pipeline-status" {
            assert!(
                needs
                    .lines()
                    .any(|line| line.trim() == format!("- {job_name}")),
                "pipeline-status does not need {job_name}"
            );
        }
    }
}

/// Exercise the policy over every relevant upstream conclusion instead of only
/// asserting on workflow text.
#[cfg(unix)]
#[test]
fn pipeline_status_script_handles_all_conclusions() {
    /// (case name, `NEEDS_JSON`, `IS_MAIN`, extra env, expected success)
    type StatusCase<'a> = (&'a str, &'a str, &'a str, &'a [(&'a str, &'a str)], bool);
    // Issue #156: a cancelled job on main is a hidden timeout only when this
    // run was still the branch head; a superseded run's cancellation is churn.
    let cases: [StatusCase; 6] = [
        (
            "success",
            r#"{"test":{"result":"success"},"docs":{"result":"skipped"}}"#,
            "true",
            &[],
            true,
        ),
        (
            "failure",
            r#"{"test":{"result":"failure"}}"#,
            "false",
            &[],
            false,
        ),
        (
            "cancelled on main",
            r#"{"test":{"result":"cancelled"}}"#,
            "true",
            &[],
            false,
        ),
        (
            "cancelled off main without a proven supersede",
            r#"{"test":{"result":"cancelled"}}"#,
            "false",
            &[],
            false,
        ),
        (
            "cancelled on main but superseded by a newer commit",
            r#"{"test":{"result":"cancelled"}}"#,
            "true",
            &[
                ("RUN_SHA", "0000000000000000000000000000000000000000"),
                ("BRANCH_REF", "main"),
                (
                    "BRANCH_HEAD_SHA",
                    "1111111111111111111111111111111111111111",
                ),
            ],
            false,
        ),
        (
            "cancelled on main while still the branch head",
            r#"{"test":{"result":"cancelled"}}"#,
            "true",
            &[
                ("RUN_SHA", "1111111111111111111111111111111111111111"),
                ("BRANCH_REF", "main"),
                (
                    "BRANCH_HEAD_SHA",
                    "1111111111111111111111111111111111111111",
                ),
            ],
            false,
        ),
    ];

    for (name, needs_json, is_main, extra_env, should_succeed) in cases {
        let mut command = std::process::Command::new("bash");
        command
            .arg("scripts/check-pipeline-status.sh")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .env("NEEDS_JSON", needs_json)
            .env("IS_MAIN", is_main)
            .env(
                "GITHUB_REF",
                if is_main == "true" {
                    "refs/heads/main"
                } else {
                    "refs/pull/7/merge"
                },
            )
            .env("WORKFLOW_FILE", ".github/workflows/release.yml")
            .env_remove("RUN_SHA")
            .env_remove("BRANCH_HEAD_SHA")
            .env_remove("HEAD_REF");
        for (key, value) in extra_env {
            command.env(key, value);
        }
        let output = command.output().expect("run pipeline status script");

        assert_eq!(
            output.status.success(),
            should_succeed,
            "{name}: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

/// Regression test for issue #100 (2): the Dockerfile must be exercised at
/// pull-request stage, not only after `cargo publish` inside the release jobs.
#[test]
fn release_workflow_builds_docker_image_on_pull_requests() {
    let workflow = release_workflow();
    let job = job_block(&workflow, "docker-build");

    assert!(
        job.contains("needs.detect-changes.outputs.any-code-changed == 'true'")
            && !job.contains("github.event_name == 'pull_request'"),
        "docker-build should validate code changes on PRs and main before release"
    );
    assert!(
        job.contains("push: false"),
        "docker-build must not push, so fork pull requests without registry credentials still work"
    );
    assert!(
        job.contains("cache-from: type=gha"),
        "docker-build should reuse the buildx layer cache"
    );
}

/// Regression test for issue #154:
/// <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/154>
///
/// Unscoped `type=gha` cache entries all land in the default `buildkit` scope,
/// so the pull-request image build and each docker-publish matrix leg evict and
/// overwrite each other's exported layers. Every GHA cache reference must pin an
/// explicit scope.
#[test]
fn release_workflow_scopes_every_gha_buildx_cache() {
    let workflow = release_workflow();

    for line in workflow.lines().filter(|line| {
        line.trim_start().starts_with("cache-from: type=gha")
            || line.trim_start().starts_with("cache-to: type=gha")
    }) {
        assert!(
            line.contains("scope="),
            "GHA buildx cache reference lacks an explicit scope, so it shares \
             the default 'buildkit' scope with unrelated builds:\n{line}"
        );
    }

    let docker_build = job_block(&workflow, "docker-build");
    assert!(
        docker_build.contains("cache-from: type=gha,scope=docker-image")
            && docker_build.contains("cache-to: type=gha,mode=max,scope=docker-image"),
        "the pull-request image build should use a dedicated scope"
    );

    let docker_publish = job_block(&workflow, "docker-publish");
    assert!(
        docker_publish.contains("cache-from: type=gha,scope=${{ matrix.platform }}")
            && docker_publish.contains("cache-to: type=gha,mode=max,scope=${{ matrix.platform }}"),
        "each docker-publish matrix leg should scope its cache by platform so \
         the legs do not overwrite each other"
    );
}

/// Regression test for issue #100 (3): a pull request that is green in isolation can
/// still break `main` (semantic merge conflict), and committed credentials must be flagged.
#[test]
fn release_workflow_simulates_fresh_merge_and_scans_for_secrets() {
    let workflow = release_workflow();

    assert!(
        job_block(&workflow, "fresh-merge").contains("bash scripts/simulate-fresh-merge.sh"),
        "fresh-merge job should run the merge simulation script"
    );
    assert!(
        job_block(&workflow, "secrets-scan").contains("secretlint"),
        "secrets-scan job should run secretlint"
    );

    let script = fs::read_to_string(format!(
        "{}/scripts/simulate-fresh-merge.sh",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    assert!(
        script.contains("set -euo pipefail"),
        "merge simulation should fail fast on unexpected errors"
    );
    assert!(
        script.contains("git merge --no-edit"),
        "merge simulation should actually merge the head into the base tip"
    );

    assert!(
        std::path::Path::new(&format!(
            "{}/.secretlintrc.json",
            env!("CARGO_MANIFEST_DIR")
        ))
        .exists(),
        "secretlint requires a .secretlintrc config file to run"
    );
}

#[test]
fn coverage_upload_uses_codecov_action_v7() {
    let workflow = release_workflow();
    let coverage = job_block(&workflow, "coverage");
    let upload = step_block(coverage, "Upload coverage to Codecov");

    assert!(
        upload.contains("codecov/codecov-action@") && upload.contains("# v7"),
        "Codecov upload must use v7 (v5 runs on Node 20 and is deprecated), hash-pinned with the \
         version in a trailing comment: {upload}"
    );
    assert!(
        !workflow.contains("codecov/codecov-action@v5"),
        "no workflow step may pin the deprecated codecov-action@v5"
    );
}

#[test]
fn file_size_check_only_annotates_changed_files() {
    let workflow = release_workflow();
    let lint = job_block(&workflow, "lint");
    let collect = step_block(lint, "Collect changed files");
    let check = step_block(lint, "Check file size limit");

    assert!(
        collect.contains("git diff --name-only"),
        "changed files must be derived from the diff against the base commit: {collect}"
    );
    assert!(
        check.contains("CHANGED_FILES: ${{ steps.changed-files.outputs.files }}"),
        "file size check must receive the changed file list: {check}"
    );
    assert!(
        lint.contains("fetch-depth: 0"),
        "full history is required to diff against the base commit: {lint}"
    );
}

#[test]
fn rustdoc_warnings_are_gated_before_release_jobs() {
    let workflow = release_workflow();

    // The first `cargo doc` invocation must be the pre-release lint gate, not
    // the post-build deploy-docs job. See issue #96.
    let first_doc_build = workflow
        .find("cargo doc")
        .expect("release workflow should build documentation");
    for release_job in ["auto-release", "manual-release", "deploy-docs"] {
        let job_start = workflow
            .find(&format!("  {release_job}:\n"))
            .unwrap_or_else(|| panic!("missing job {release_job}"));
        assert!(
            first_doc_build < job_start,
            "first `cargo doc` must run before the {release_job} job"
        );
    }

    let lint = job_block(&workflow, "lint");
    let lint_docs = step_block(lint, "Build documentation");
    assert!(lint_docs.contains("RUSTDOCFLAGS: -D warnings"));
    assert!(lint_docs.contains("cargo doc --no-deps --all-features"));
}

#[test]
fn documentation_deploy_keeps_fail_closed_rustdoc_flags() {
    let workflow = release_workflow();
    let deploy_docs = job_block(&workflow, "deploy-docs");
    let build_docs = step_block(deploy_docs, "Build documentation");

    assert!(build_docs.contains("RUSTDOCFLAGS: -D warnings"));
    assert!(build_docs.contains("cargo doc --no-deps --all-features"));
}
