//! Regression tests for issue #149.
//!
//! `release.yml` declared the crates.io credentials in the workflow-level
//! `env:` block. That block is inherited by *every* job in the workflow,
//! including the `pull_request` jobs that compile and run code from the branch
//! under review (`build.rs`, procedural macros, the tests themselves). A
//! one-line `build.rs` in a branch pull request could therefore read the
//! publish token out of its own environment.
//!
//! Only two steps need the credentials, and both declare them at step level.
//! These tests pin the invariant in both directions: no workflow-level `env:`
//! value anywhere under `.github/workflows` may reference `secrets.`, and the
//! two publish steps must still receive OIDC credentials or token fallback.

use std::fs;

fn workflows() -> Vec<(String, String)> {
    let dir = format!("{}/.github/workflows", env!("CARGO_MANIFEST_DIR"));
    let mut files: Vec<(String, String)> = fs::read_dir(&dir)
        .expect("the workflows directory should exist")
        .map(|entry| entry.expect("workflow entry should be readable").path())
        .filter(|path| {
            matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("yml" | "yaml")
            )
        })
        .map(|path| {
            let name = path
                .file_name()
                .expect("workflow file should have a name")
                .to_string_lossy()
                .into_owned();
            let body = fs::read_to_string(&path)
                .expect("workflow should be readable")
                .replace("\r\n", "\n");
            (name, body)
        })
        .collect();
    files.sort_by(|left, right| left.0.cmp(&right.0));
    assert!(!files.is_empty(), "there should be workflows to audit");
    files
}

/// The workflow-level `env:` block: every line until the next top-level key.
fn workflow_level_env(workflow: &str) -> Vec<&str> {
    let mut lines = workflow.lines();
    let Some(_) = lines.find(|line| *line == "env:") else {
        return Vec::new();
    };
    lines
        .take_while(|line| line.trim().is_empty() || line.starts_with([' ', '\t']))
        .collect()
}

/// The defect itself. A workflow-level `env:` reaches every job, so a secret
/// declared there is handed to jobs that only run `cargo test` on a branch.
#[test]
fn no_workflow_level_env_value_references_a_secret() {
    for (name, body) in workflows() {
        for line in workflow_level_env(&body) {
            assert!(
                !line.contains("secrets."),
                "{name}: workflow-level env is inherited by every job, including the \
                 pull_request jobs that run branch code; declare secrets on the job or \
                 step that needs them instead: {}",
                line.trim()
            );
        }
    }
}

/// Narrower restatement of the same rule for the credential that prompted it.
#[test]
fn release_workflow_level_env_omits_the_crates_io_credentials() {
    let (_, release) = workflows()
        .into_iter()
        .find(|(name, _)| name == "release.yml")
        .expect("release.yml should exist");

    for line in workflow_level_env(&release) {
        let declaration = line.trim();
        assert!(
            !declaration.starts_with("CARGO_REGISTRY_TOKEN:")
                && !declaration.starts_with("CARGO_TOKEN:"),
            "release.yml must not put the crates.io publish credentials in the \
             workflow-level env: {declaration}"
        );
    }
}

/// The other direction: removing the inherited env must not disarm publishing.
#[test]
fn both_publish_steps_declare_the_crates_io_credentials() {
    let (_, release) = workflows()
        .into_iter()
        .find(|(name, _)| name == "release.yml")
        .expect("release.yml should exist");

    let publish_steps: Vec<&str> = release
        .split("- name: Publish to Crates.io")
        .skip(1)
        .collect();

    assert_eq!(
        publish_steps.len(),
        2,
        "release.yml should publish from exactly two jobs (auto-release and manual-release)"
    );

    for step in publish_steps {
        let step = step
            .split("\n      - name:")
            .next()
            .expect("a step body should be present");
        assert!(
            step.contains(
                "CARGO_REGISTRY_TOKEN: ${{ steps.crates_auth.outputs.token || secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}"
            ),
            "the publish step must declare CARGO_REGISTRY_TOKEN itself, since it is no \
             longer inherited from the workflow-level env"
        );
    }
}
