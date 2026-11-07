//! Regression tests for issue #156.
//!
//! `check-pipeline-status.sh` was wired only into `release.yml`, and a
//! `cancelled` conclusion was treated as a hidden timeout on every ref. The
//! gate now exists in every workflow, and a cancelled job is excused only when
//! the run was superseded and that job literally opts into cancellation.

use std::fs;
use std::path::PathBuf;

fn repo_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn workflow(name: &str) -> String {
    fs::read_to_string(repo_path(&format!(".github/workflows/{name}")))
        .unwrap_or_else(|error| panic!("workflow {name} should exist: {error}"))
        .replace("\r\n", "\n")
}

fn workflow_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(repo_path(".github/workflows"))
        .expect("workflows directory should exist")
        .map(|entry| entry.expect("workflow entry").file_name())
        .filter(|name| {
            std::path::Path::new(name)
                .extension()
                .is_some_and(|extension| extension == "yml" || extension == "yaml")
        })
        .map(|name| name.to_string_lossy().into_owned())
        // Callable workflows report their result through the caller observer.
        .filter(|name| !workflow(name).contains("  workflow_call:"))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "there should be at least one workflow");
    names
}

/// A job's YAML block: everything from its two-space header to the next header
/// at the same indentation. Jobs are the only two-space keys inside `jobs:`.
struct Job {
    name: String,
    body: String,
}

fn jobs(workflow: &str) -> Vec<Job> {
    let jobs_start = workflow
        .find("\njobs:\n")
        .map_or(0, |offset| offset + "\njobs:\n".len());
    let mut jobs: Vec<Job> = Vec::new();
    for line in workflow[jobs_start..].lines() {
        let is_job_header = line.starts_with("  ")
            && !line.starts_with("   ")
            && line.trim_end().ends_with(':')
            && !line.trim_start().starts_with('#');
        if is_job_header {
            jobs.push(Job {
                name: line.trim().trim_end_matches(':').to_owned(),
                body: String::new(),
            });
        } else if let Some(current) = jobs.last_mut() {
            current.body.push_str(line);
            current.body.push('\n');
        }
    }
    jobs
}

fn job_names(workflow: &str) -> Vec<String> {
    jobs(workflow).into_iter().map(|job| job.name).collect()
}

fn gate_needs(body: &str) -> Vec<String> {
    let mut needs: Vec<String> = Vec::new();
    let mut in_needs = false;
    for line in body.lines() {
        if line.starts_with("    needs:") {
            in_needs = true;
            continue;
        }
        if in_needs {
            if let Some(entry) = line.trim_start().strip_prefix("- ") {
                needs.push(entry.trim().to_owned());
            } else {
                break;
            }
        }
    }
    needs
}

#[test]
fn every_workflow_has_a_terminal_status_gate() {
    for name in workflow_names() {
        let content = workflow(&name);
        assert!(
            jobs(&content)
                .iter()
                .any(|job| job.name == "pipeline-status"),
            "{name} has no pipeline-status job: jobs killed by timeout-minutes are \
             reported as 'cancelled' and would hide the failure"
        );
    }
}

#[test]
fn the_gate_observes_every_other_job() {
    for name in workflow_names() {
        let content = workflow(&name);
        let names = job_names(&content);
        let gate = jobs(&content)
            .into_iter()
            .find(|job| job.name == "pipeline-status")
            .expect("gate exists (checked by every_workflow_has_a_terminal_status_gate)");

        assert!(
            gate.body.contains("if: ${{ !cancelled() }}"),
            "{name}: the gate must inspect failed jobs without repainting a whole-run cancellation"
        );

        let needs = gate_needs(&gate.body);
        for other in &names {
            if other == "pipeline-status" {
                continue;
            }
            assert!(
                needs.contains(other),
                "{name}: pipeline-status does not observe job {other:?}; its failure \
                 cannot fail the run"
            );
        }
    }
}

#[test]
fn the_gate_receives_what_supersede_detection_needs() {
    for name in workflow_names() {
        let gate = jobs(&workflow(&name))
            .into_iter()
            .find(|job| job.name == "pipeline-status")
            .unwrap();

        for required in [
            "RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
            "HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head'",
        ] {
            assert!(
                gate.body.contains(required),
                "{name}: pipeline-status is missing {required}; without it a cancelled \
                 job cannot be told apart from a superseded run"
            );
        }
    }
}

#[test]
fn the_script_treats_an_unresolvable_head_as_not_superseded() {
    let script = fs::read_to_string(repo_path("scripts/check-pipeline-status.sh"))
        .expect("check-pipeline-status.sh should exist")
        .replace("\r\n", "\n");

    assert!(
        script.contains("git ls-remote \"$GIT_REMOTE\""),
        "the branch head should be resolved from the remote"
    );
    assert!(
        script.contains("BRANCH_HEAD_SHA"),
        "an optional pre-resolved head keeps the gate working when the remote is \
         unreachable from the job"
    );
    assert!(
        script.contains("cannot prove this run was superseded"),
        "every unresolvable path must say out loud that the cancelled job is \
         treated as a real failure -- silence here would be the bug this gate \
         exists to prevent"
    );
}
