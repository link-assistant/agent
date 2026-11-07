//! Repository-wide policy regressions for the eleven issues collected in #188.
use std::fs;
use std::path::Path;

fn read(path: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path))
        .unwrap_or_else(|error| panic!("{path}: {error}"))
        .replace("\r\n", "\n")
}

#[test]
fn every_workflow_pins_ubuntu_and_macos_runner_aliases() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".github/workflows");
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if !path
            .extension()
            .is_some_and(|ext| ext == "yml" || ext == "yaml")
        {
            continue;
        }
        for line in fs::read_to_string(&path).unwrap().lines() {
            if !line.trim_start().starts_with('#') {
                assert!(
                    !line.contains("ubuntu-latest"),
                    "{}: {line}",
                    path.display()
                );
                assert!(!line.contains("macos-latest"), "{}: {line}", path.display());
            }
        }
    }
}

#[test]
fn workflow_tool_checker_is_a_required_job_and_runs_on_checker_edits() {
    let workflow = read(".github/workflows/workflows.yml");
    assert!(workflow.contains("  workflow-tools:\n"));
    assert!(workflow.contains("      - workflow-tools\n"));
    assert!(workflow.contains("'scripts/check-workflow-tools.rs'"));
    assert!(workflow.contains("rustc scripts/check-workflow-tools.rs"));
}

#[test]
fn cargo_warnings_gate_is_in_lint_and_fresh_merge() {
    for path in [
        ".github/workflows/release.yml",
        "scripts/simulate-fresh-merge.sh",
    ] {
        assert!(
            read(path).contains("bash scripts/check-cargo-warnings.sh"),
            "{path}"
        );
    }
}

#[test]
fn doc_tests_run_once_within_the_all_features_suite() {
    let workflow = read(".github/workflows/release.yml");
    assert!(workflow.contains("cargo test --all-features --verbose"));
    assert!(!workflow.contains("cargo test --doc"));
    assert!(!workflow.contains("DOC_TEST_BUDGET_SECONDS"));
}

#[test]
fn credentials_persist_explicitly_only_in_serialized_release_writers() {
    let workflow = read(".github/workflows/release.yml");
    let mut writer = false;
    let mut main_write_group = false;
    for line in workflow.lines() {
        if line.starts_with("  ") && !line.starts_with("   ") && line.ends_with(':') {
            writer = matches!(line.trim(), "auto-release:" | "manual-release:");
            main_write_group = false;
        }
        if line.contains("group:") && line.contains("main-write") {
            main_write_group = true;
        }
        if line.trim() == "persist-credentials: true" {
            assert!(
                writer && main_write_group,
                "unexpected credential writer: {line}"
            );
        }
    }
    assert_eq!(workflow.matches("persist-credentials: true").count(), 2);
}

#[test]
fn security_scanners_and_secretlint_are_pinned() {
    let workflow = read(".github/workflows/workflows.yml");
    assert!(workflow.contains("min-confidence: low"));
    assert!(workflow.contains("zizmor-action@v0.6.4"));
    assert!(workflow.contains("version: 1.30.1"));
    let release = read(".github/workflows/release.yml");
    assert!(release.contains("secretlint@13.0.7"));
    assert!(release.contains("@secretlint/secretlint-rule-preset-recommend@13.0.7"));
    assert!(release.contains("npm ci --prefix .github/secretlint --ignore-scripts"));
    assert!(release.contains("node --test .github/scripts/check-secrets.test.mjs"));
    assert!(release.contains("node .github/scripts/check-secrets.mjs"));
    let manifest = read(".github/secretlint/package.json");
    assert!(manifest.contains("\"secretlint\": \"13.0.7\""));
    assert!(manifest.contains("\"@secretlint/secretlint-rule-preset-recommend\": \"13.0.7\""));
    assert!(read(".github/secretlint/package-lock.json").contains("\"lockfileVersion\": 3"));
}

#[test]
fn codeql_excludes_experiments_and_link_throttling_config_triggers_checks() {
    let security = read(".github/workflows/security.yml");
    assert!(security.contains("build-mode: none"));
    assert!(security.contains("config-file: ./.github/codeql/codeql-config.yml"));
    assert!(read(".github/codeql/codeql-config.yml").contains("  - experiments"));
    assert_eq!(
        read(".github/workflows/links.yml")
            .matches("      - 'lychee.toml'")
            .count(),
        2
    );
    let lychee = read("lychee.toml");
    assert!(lychee.contains("concurrency = 2"));
    assert!(lychee.contains("request_interval = \"1s\""));
}

#[test]
fn crate_wait_has_about_ten_minutes_of_retry_margin() {
    let wait = read("scripts/wait-for-crate.rs");
    assert!(wait.contains("parse_count_arg(\"max-attempts\", 40)"));
    assert!(wait.contains("parse_count_arg(\"sleep-seconds\", 15)"));
}
