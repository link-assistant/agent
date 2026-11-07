use std::fs;

pub(super) fn release_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/release.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    .replace("\r\n", "\n")
}

pub(super) fn job_block<'a>(workflow: &'a str, job_name: &str) -> &'a str {
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

pub(super) fn step_block<'a>(job: &'a str, step_name: &str) -> &'a str {
    let marker = format!("      - name: {step_name}\n");
    let start = job
        .find(&marker)
        .unwrap_or_else(|| panic!("could not find workflow step {step_name:?}"));
    let body_start = start + marker.len();
    let rest = &job[body_start..];

    let next_step = rest
        .lines()
        .scan(0usize, |offset, line| {
            let current_offset = *offset;
            *offset += line.len() + 1;
            Some((current_offset, line))
        })
        .find_map(|(offset, line)| line.starts_with("      - name: ").then_some(offset));

    next_step.map_or_else(|| &job[start..], |end| &job[start..body_start + end])
}

pub(super) fn workflow_job_names(workflow: &str) -> Vec<&str> {
    let marker = "jobs:\n";
    let start = workflow.find(marker).unwrap() + marker.len();

    workflow[start..]
        .lines()
        .filter_map(|line| {
            let starts_at_job_indent = line.starts_with("  ") && !line.starts_with("    ");
            (starts_at_job_indent && line.trim_end().ends_with(':'))
                .then(|| line.trim().trim_end_matches(':'))
        })
        .collect()
}

fn workflow_env_block(workflow: &str) -> &str {
    let env_start = workflow.find("\nenv:\n").unwrap();
    let jobs_start = workflow.find("\njobs:\n").unwrap();

    &workflow[env_start..jobs_start]
}

#[test]
fn documentation_deploy_is_independent_from_release_publication() {
    let workflow = release_workflow();
    let deploy_docs = job_block(&workflow, "deploy-docs");

    assert!(deploy_docs.contains("needs: [javascript-first, build]"));
    assert!(deploy_docs.contains("needs.build.result == 'success'"));
    assert!(deploy_docs.contains("github.ref == 'refs/heads/main'"));
    assert!(!deploy_docs.contains("needs: [auto-release, manual-release]"));
    assert!(!deploy_docs.contains("needs.auto-release.result"));
    assert!(!deploy_docs.contains("needs.manual-release.result"));
}

#[test]
fn documentation_deploy_uses_github_pages_artifact_flow() {
    let workflow = release_workflow();
    let deploy_docs = job_block(&workflow, "deploy-docs");

    assert!(deploy_docs.contains("contents: read"));
    assert!(deploy_docs.contains("pages: write"));
    assert!(deploy_docs.contains("id-token: write"));
    assert!(deploy_docs.contains("environment:"));
    assert!(deploy_docs.contains("name: github-pages"));
    assert!(deploy_docs.contains("url: ${{ steps.deployment.outputs.page_url }}"));
    assert!(deploy_docs.contains("uses: actions/configure-pages@v6"));
    assert!(deploy_docs.contains("uses: actions/upload-pages-artifact@v5"));
    assert!(deploy_docs.contains("path: target/doc"));
    assert!(deploy_docs.contains("id: deployment"));
    assert!(deploy_docs.contains("uses: actions/deploy-pages@v5"));
    assert!(!deploy_docs.contains("contents: write"));
    assert!(!deploy_docs.contains("peaceiris/actions-gh-pages"));
    assert!(!deploy_docs.contains("publish_dir: target/doc"));
}

#[test]
fn documentation_deploy_publishes_working_pages_root() {
    let workflow = release_workflow();
    let deploy_docs = job_block(&workflow, "deploy-docs");

    let build_docs = deploy_docs
        .find("- name: Build documentation")
        .expect("deploy-docs should build rustdoc output");
    let generate_root = deploy_docs
        .find("- name: Generate Pages root index")
        .expect("deploy-docs should generate a root index for GitHub Pages");
    let verify_tree = deploy_docs
        .find("- name: Verify site tree")
        .expect("deploy-docs should log the artifact tree before upload");
    let upload_artifact = deploy_docs
        .find("- name: Upload GitHub Pages artifact")
        .expect("deploy-docs should upload the Pages artifact");

    assert!(
        build_docs < generate_root && generate_root < verify_tree && verify_tree < upload_artifact,
        "deploy-docs should build docs, add root Pages files, verify the tree, then upload"
    );
    assert!(
        deploy_docs.contains("cargo metadata --no-deps --format-version 1"),
        "root redirect should derive the crate docs directory from cargo metadata"
    );
    assert!(
        deploy_docs.contains(r#"replace("-","_")"#),
        "root redirect should use rustdoc's crate directory naming"
    );
    assert!(
        deploy_docs.contains("target/doc/index.html"),
        "GitHub Pages artifact should contain a root index.html"
    );
    assert!(
        deploy_docs.contains("url=%s/index.html"),
        "root index.html should redirect to the crate rustdoc index"
    );
    assert!(
        deploy_docs.contains("target/doc/.nojekyll"),
        "GitHub Pages artifact should disable Jekyll so rustdoc assets are served verbatim"
    );
    assert!(
        deploy_docs.contains("include-hidden-files: true"),
        "Pages artifact upload should include the hidden .nojekyll file"
    );
    assert!(
        deploy_docs.contains("find target/doc -maxdepth 2 -print"),
        "deploy-docs should log the published tree for easier CI diagnosis"
    );
}

#[test]
fn release_workflow_jobs_have_explicit_timeouts() {
    let workflow = release_workflow();
    let expected_timeouts = [
        ("javascript-first", 0),
        ("detect-changes", 5),
        // Docs validation (issue #161): required documents and their sections.
        ("validate-docs", 5),
        // Probes the publish credentials before the matrix spends a minute
        // (issues #163 and #167).
        ("release-preflight", 5),
        ("changelog", 10),
        ("version-check", 5),
        ("secrets-scan", 10),
        ("fresh-merge", 30),
        ("docker-build", 60),
        ("cargo-lock", 5),
        ("lint", 10),
        // Raised from 20 so the step budgets in the test job stay at or below the
        // 70% share the invariant in issue_135.rs enforces. See issue #135.
        ("test", 30),
        // Compiles and runs every scripts/*.rs test harness from scratch; the
        // cargo-install of rust-script dominates a cold run. See issue #150.
        ("script-tests", 20),
        ("coverage", 15),
        ("build", 10),
        ("auto-release", 60),
        ("manual-release", 60),
        ("release-javascript-first", 0),
        ("docker-publish", 60),
        ("docker-merge-manifest", 10),
        ("changelog-pr", 10),
        ("deploy-docs", 15),
        ("pipeline-status", 5),
    ];

    let actual_jobs = workflow_job_names(&workflow);
    let expected_jobs = expected_timeouts
        .iter()
        .map(|(job_name, _)| *job_name)
        .collect::<Vec<_>>();
    assert_eq!(actual_jobs, expected_jobs);

    for (job_name, timeout_minutes) in expected_timeouts {
        let job = job_block(&workflow, job_name);
        if timeout_minutes == 0 {
            assert!(job.contains("uses: ./.github/workflows/javascript-first-gate.yml"));
            let gate = fs::read_to_string(format!(
                "{}/.github/workflows/javascript-first-gate.yml",
                env!("CARGO_MANIFEST_DIR")
            ))
            .unwrap()
            .replace("\r\n", "\n");
            assert!(gate.contains("    timeout-minutes: 30\n"));
            continue;
        }
        let expected = format!("    timeout-minutes: {timeout_minutes}\n");
        assert!(
            job.contains(&expected),
            "{job_name} should declare {expected:?}"
        );
    }
}

#[test]
fn cargo_cache_keys_are_scoped_by_job() {
    let workflow = release_workflow();

    for (job_name, expected_key) in [
        (
            "lint",
            "key: ${{ runner.os }}-cargo-lint-${{ hashFiles('**/Cargo.lock') }}",
        ),
        (
            "coverage",
            "key: ${{ runner.os }}-cargo-coverage-${{ hashFiles('**/Cargo.lock') }}",
        ),
        (
            "build",
            "key: ${{ runner.os }}-cargo-build-${{ hashFiles('**/Cargo.lock') }}",
        ),
    ] {
        let job = job_block(&workflow, job_name);
        assert!(
            job.contains(expected_key),
            "{job_name} should use a job-scoped cargo cache key"
        );
    }

    let test = job_block(&workflow, "test");
    assert!(
        test.contains(
            "key: ${{ runner.os }}-cargo-test-registry-${{ hashFiles('**/Cargo.lock') }}"
        ),
        "Windows test cache should use a test registry key"
    );
    assert!(
        test.contains("key: ${{ runner.os }}-cargo-test-${{ hashFiles('**/Cargo.lock') }}"),
        "Unix test cache should use a test target key"
    );
    assert!(
        !workflow.contains("key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}"),
        "jobs should not share the old generic cargo cache key"
    );
}

#[test]
fn windows_test_cache_does_not_archive_target_directory() {
    let workflow = release_workflow();
    let test = job_block(&workflow, "test");

    let windows_cache = step_block(test, "Cache cargo registry on Windows");
    assert!(windows_cache.contains("if: runner.os == 'Windows'"));
    assert!(windows_cache.contains("~/.cargo/registry"));
    assert!(windows_cache.contains("~/.cargo/git"));
    assert!(
        !windows_cache.contains("\n            target\n"),
        "Windows should not archive the large target directory during post-job cleanup"
    );

    let unix_cache = step_block(test, "Cache cargo registry and target on Unix");
    assert!(unix_cache.contains("if: runner.os != 'Windows'"));
    assert!(unix_cache.contains("~/.cargo/registry"));
    assert!(unix_cache.contains("~/.cargo/git"));
    assert!(unix_cache.contains("\n            target\n"));
}

#[test]
fn coverage_upload_requires_token_and_reports_missing_token_as_notice() {
    let workflow = release_workflow();
    let coverage = job_block(&workflow, "coverage");
    let upload = step_block(coverage, "Upload coverage to Codecov");

    assert!(coverage.contains("CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}"));
    assert!(upload.contains("if: env.CODECOV_TOKEN != ''"));
    assert!(upload.contains("token: ${{ env.CODECOV_TOKEN }}"));
    assert!(upload.contains("disable_search: true"));
    assert!(upload.contains("fail_ci_if_error: true"));
    assert!(!upload.contains("fail_ci_if_error: false"));

    let skipped = step_block(coverage, "Report skipped Codecov upload");
    assert!(skipped.contains("if: env.CODECOV_TOKEN == ''"));
    assert!(skipped
        .contains("::notice::Skipping Codecov upload because CODECOV_TOKEN is not configured"));
}

#[test]
fn test_job_is_gated_by_detected_code_changes_not_changelog_result() {
    let workflow = release_workflow();
    let test = job_block(&workflow, "test");

    assert!(
        test.contains("needs: [javascript-first, detect-changes, cargo-lock]"),
        "test job should depend on change detection and the Cargo.lock guard"
    );
    assert!(
        !test.contains("needs.changelog.result"),
        "test job should not infer file changes from the changelog job result"
    );
    assert!(
        test.contains("needs.cargo-lock.result == 'success'"),
        "test job should not run unless the Cargo.lock guard passes"
    );
    assert!(
        !test.contains("docs-changed"),
        "docs-only changes should not run the full test matrix"
    );

    for output in [
        "any-code-changed",
        "rs-changed",
        "toml-changed",
        "workflow-changed",
    ] {
        assert!(
            test.contains(&format!("needs.detect-changes.outputs.{output} == 'true'")),
            "test job should run when {output} is true"
        );
    }
}

#[test]
fn change_gated_jobs_consult_detector_outputs_for_pull_requests_and_pushes() {
    let workflow = release_workflow();

    for job_name in ["cargo-lock", "lint", "test", "coverage"] {
        let job = job_block(&workflow, job_name);
        assert!(
            !job.contains("github.event_name == 'push'"),
            "{job_name} must not bypass excluded-path detection on pushes"
        );
        assert!(
            job.contains("github.event_name == 'workflow_dispatch'"),
            "{job_name} should continue to run when manually dispatched"
        );
        assert!(
            job.contains("needs.detect-changes.outputs."),
            "{job_name} should use detector outputs for PR and push events"
        );
    }
}

#[test]
fn cargo_lock_guard_blocks_cached_cargo_jobs() {
    let workflow = release_workflow();
    let cargo_lock = job_block(&workflow, "cargo-lock");

    assert!(
        cargo_lock.contains("rust-script scripts/check-cargo-lock.rs"),
        "workflow should run the committed Cargo.lock guard"
    );
    assert!(
        workflow.contains("hashFiles('**/Cargo.lock')")
            && workflow.contains("silently degrading to the empty hash"),
        "workflow should document why an absent lockfile breaks cache determinism"
    );
    assert!(
        !cargo_lock.contains("actions/cache"),
        "guard job should run before any cargo cache restore"
    );

    for job_name in ["lint", "test", "coverage"] {
        let job = job_block(&workflow, job_name);
        assert!(
            job.contains("needs: [javascript-first, detect-changes, cargo-lock]"),
            "{job_name} should depend on the Cargo.lock guard before restoring cargo caches"
        );
        assert!(
            job.contains("needs.cargo-lock.result == 'success'"),
            "{job_name} should require the Cargo.lock guard to pass"
        );
    }
}

#[test]
fn release_workflow_hardens_cargo_registry_networking() {
    let workflow = release_workflow();
    let global_env = workflow_env_block(&workflow);

    assert!(
        global_env.contains("CARGO_NET_RETRY: '10'"),
        "top-level workflow env should retry transient Cargo registry failures"
    );
    assert!(
        global_env.contains("CARGO_HTTP_MULTIPLEXING: 'false'"),
        "top-level workflow env should disable HTTP multiplexing for Cargo downloads"
    );
    assert!(
        global_env.contains("HTTP/2 framing"),
        "workflow should document the transient failure mode this hardening targets"
    );
}

#[test]
fn release_workflow_sets_git_initial_branch_before_checkout() {
    let workflow = release_workflow();
    let global_env = workflow_env_block(&workflow);

    assert!(
        global_env.contains("GIT_CONFIG_COUNT: '1'"),
        "top-level workflow env should declare one Git runtime config entry"
    );
    assert!(
        global_env.contains("GIT_CONFIG_KEY_0: init.defaultBranch"),
        "top-level workflow env should set the Git init default branch key"
    );
    assert!(
        global_env.contains("GIT_CONFIG_VALUE_0: main"),
        "top-level workflow env should set Git's init default branch to main"
    );

    let git_config = workflow
        .find("GIT_CONFIG_KEY_0: init.defaultBranch")
        .expect("workflow should set Git's default initial branch");
    let first_checkout = workflow
        .find("uses: actions/checkout@v7")
        .expect("workflow should use actions/checkout");
    assert!(
        git_config < first_checkout,
        "Git runtime config should be available before checkout initializes the repository"
    );
}

#[test]
fn release_workflow_publishes_optional_docker_hub_image_after_crate_is_visible() {
    let workflow = release_workflow();

    assert!(
        workflow.contains("DOCKERHUB_IMAGE: ${{ vars.DOCKERHUB_IMAGE }}"),
        "workflow should expose an opt-in Docker Hub image variable"
    );
    assert_eq!(
        workflow.matches("docker/login-action@v4").count(),
        2,
        "architecture publication and manifest merging should log in to Docker Hub"
    );
    assert_eq!(
        workflow.matches("docker/build-push-action@v7").count(),
        2,
        "the workflow should have one matrix publication step plus the pull-request build check"
    );
    assert!(
        workflow.contains("password: ${{ env.DOCKERHUB_TOKEN }}"),
        "Docker Hub login should use DOCKERHUB_TOKEN"
    );

    let auto_release = job_block(&workflow, "auto-release");
    let auto_publish = auto_release
        .find("- name: Publish to Crates.io")
        .expect("auto release should publish the crate");
    let auto_wait = auto_release
        .find("- name: Wait for Crate availability on Crates.io")
        .expect("auto release should wait for the crate");
    let auto_github_release = auto_release
        .find("- name: Create GitHub Release")
        .expect("auto release should create a GitHub release");

    assert!(
        auto_publish < auto_wait && auto_wait < auto_github_release,
        "auto release should publish and verify crates.io before creating the GitHub release"
    );

    let manual_release = job_block(&workflow, "manual-release");
    let manual_publish = manual_release
        .find("- name: Publish to Crates.io")
        .expect("manual release should publish the crate");
    let manual_wait = manual_release
        .find("- name: Wait for Crate availability on Crates.io")
        .expect("manual release should wait for the crate");
    let manual_github_release = manual_release
        .find("- name: Create GitHub Release")
        .expect("manual release should create a GitHub release");

    assert!(
        manual_publish < manual_wait && manual_wait < manual_github_release,
        "manual release should publish and verify crates.io before creating the GitHub release"
    );

    let docker_publish = job_block(&workflow, "docker-publish");
    assert!(docker_publish.contains(
        "needs: [release-javascript-first, auto-release, manual-release, release-preflight]"
    ));
    assert!(docker_publish.contains("push-by-digest=true"));
}

#[test]
fn release_jobs_smoke_test_published_crate_before_release_artifacts() {
    let workflow = release_workflow();

    for job_name in ["auto-release", "manual-release"] {
        let job = job_block(&workflow, job_name);
        let wait = job
            .find("- name: Wait for Crate availability on Crates.io")
            .unwrap_or_else(|| panic!("{job_name} should wait for crates.io visibility"));
        let smoke = job
            .find("- name: Smoke-test published crate")
            .unwrap_or_else(|| panic!("{job_name} should smoke-test the published crate"));
        let docker = job
            .find("- name: Configure Docker Hub publishing")
            .unwrap_or_else(|| panic!("{job_name} should configure Docker Hub publishing"));
        let github_release = job
            .find("- name: Create GitHub Release")
            .unwrap_or_else(|| panic!("{job_name} should create a GitHub release"));

        assert!(
            wait < smoke && smoke < docker && smoke < github_release,
            "{job_name} should verify the installable crates.io artifact before release artifacts"
        );
        assert!(
            job.contains("rust-script scripts/smoke-test-published-crate.rs"),
            "{job_name} should run the reusable published-crate smoke-test script"
        );
    }
}

#[test]
fn release_jobs_check_crate_size_before_publishing() {
    let workflow = release_workflow();

    for job_name in ["auto-release", "manual-release"] {
        let job = job_block(&workflow, job_name);

        let size_check = job
            .find("- name: Check crate package size")
            .unwrap_or_else(|| panic!("{job_name} should guard the crate size before publishing"));
        let publish = job
            .find("- name: Publish to Crates.io")
            .unwrap_or_else(|| panic!("{job_name} should publish the crate"));

        assert!(
            size_check < publish,
            "{job_name} should check the crate size before publishing to crates.io"
        );
        assert!(
            job.contains("rust-script scripts/check-crate-size.rs"),
            "{job_name} should run the check-crate-size guard script"
        );
    }
}

#[test]
fn build_job_checks_crate_size() {
    let workflow = release_workflow();
    let build = job_block(&workflow, "build");

    assert!(
        build.contains("- name: Check crate package size"),
        "build job should surface oversized packages early on PRs"
    );
    assert!(
        build.contains("rust-script scripts/check-crate-size.rs"),
        "build job should run the check-crate-size guard script"
    );
}

#[test]
fn crate_size_guard_uses_documented_crates_io_limit() {
    let script = fs::read_to_string(format!(
        "{}/scripts/check-crate-size.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();

    assert!(
        script.contains("10 * 1024 * 1024"),
        "size guard should encode the crates.io 10 MiB upload limit"
    );
}

#[test]
fn cargo_manifest_uses_narrow_include_allowlist() {
    let manifest =
        fs::read_to_string(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR"))).unwrap();

    assert!(
        manifest.contains("include = ["),
        "Cargo.toml should declare a narrow include allowlist to keep release archives small"
    );
    assert!(
        manifest.contains("\"src/**/*.rs\""),
        "include allowlist should ship the crate sources"
    );
    // Docs, case studies, changelog fragments, scripts, and experiments must not
    // be opted into the published archive.
    for excluded in ["\"docs/", "\"changelog.d/", "\"scripts/", "\"experiments/"] {
        assert!(
            !manifest.contains(excluded),
            "include allowlist should not bundle {excluded} into release archives"
        );
    }
}

#[test]
fn release_scripts_check_configured_release_artifacts() {
    let release_check = fs::read_to_string(format!(
        "{}/scripts/check-release-needed.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let wait_for_crate = fs::read_to_string(format!(
        "{}/scripts/wait-for-crate.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let release_script = fs::read_to_string(format!(
        "{}/scripts/create-github-release.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();

    assert!(
        release_check.contains("check_docker_hub_tag"),
        "release-needed check should verify configured Docker Hub tags"
    );
    assert!(
        release_check.contains("check_docker_hub_tag(image, \"latest\")"),
        "release-needed check should verify Docker Hub latest tags as part of completeness"
    );
    assert!(
        release_check.contains("check_github_release"),
        "release-needed check should verify GitHub release artifacts"
    );
    assert!(
        release_check.contains("crate_published"),
        "release-needed check should output whether the crate already exists"
    );
    assert!(
        wait_for_crate.contains("crates.io/api/v1/crates"),
        "release workflow should wait for crates.io visibility before image publishing"
    );
    assert!(
        wait_for_crate.contains("example-sum-package-name")
            && wait_for_crate.contains("crate_available\", \"skipped\""),
        "crate availability wait should preserve template-safe publishing skips"
    );
    assert!(
        release_script.contains("--docker-hub-url"),
        "GitHub release creation should accept a Docker Hub URL"
    );
    assert!(
        release_script.contains("fn docker_hub_badge"),
        "GitHub release notes should include Docker Hub badge support"
    );
}

#[test]
fn github_release_notes_use_static_docs_rs_badge_for_versioned_artifacts() {
    let release_script = fs::read_to_string(format!(
        "{}/scripts/create-github-release.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let release_naming = fs::read_to_string(format!(
        "{}/scripts/release-naming.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();

    assert!(
        release_script.contains("build_docs_rs_badge"),
        "GitHub release creation should render docs.rs badges through the shared release helper"
    );
    assert!(
        release_naming.contains("img.shields.io/badge/docs.rs"),
        "GitHub release notes should use a static Shields.io docs.rs badge"
    );
    assert!(
        release_naming.contains("https://docs.rs/{crate_name}/{normalized_semver}"),
        "GitHub release notes should still link to the exact docs.rs version page"
    );
    assert!(
        !release_script.contains("https://docs.rs/{crate_name}/badge.svg"),
        "GitHub release notes should not use the live docs.rs status badge"
    );
    assert!(
        !release_naming.contains("https://docs.rs/{crate_name}/badge.svg"),
        "release badge helpers should not preserve the live docs.rs status badge"
    );
}

#[test]
fn rust_script_is_installed_through_the_retrying_locked_helper() {
    let workflow = release_workflow();

    assert!(
        !workflow.contains("run: cargo install rust-script"),
        "release workflow should not invoke bare `cargo install rust-script`; \
         a registry blip would fail the release without retry or --locked"
    );
    assert!(
        workflow.contains("run: ./scripts/install-rust-script.sh"),
        "release workflow should install rust-script through scripts/install-rust-script.sh"
    );

    let helper = fs::read_to_string(format!(
        "{}/scripts/install-rust-script.sh",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();

    assert!(
        helper.contains("command -v rust-script"),
        "installer should short-circuit when rust-script is already present"
    );
    assert!(
        helper.contains("--version \"$RUST_SCRIPT_VERSION\" --locked --force"),
        "installer should use --locked for reproducible installs"
    );
    assert!(
        helper.contains("for attempt in 1 2 3"),
        "installer should retry transient registry failures with backoff"
    );
}
