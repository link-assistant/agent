#!/usr/bin/env rust-script
//! Every workflow job must install the tools it runs (issue #178).
//!
//! GitHub-hosted runners start each job on a fresh machine, so a tool installed
//! in one job is absent from every other. Router's v1.15.0 release failed exactly
//! that way: `publish-release-artifacts` ran `rust-script` without installing
//! it, exited 127 on all four platforms, and published no binaries.
//! Router's `check-release-workflow.rs` matches snippets
//! anywhere in the file and the install line existed in other jobs.
//!
//! This check reads each job on its own and fails when a job uses a
//! non-preinstalled tool without an earlier step that installs it.
//!
//! Usage: rust-script scripts/check-workflow-tools.rs [--verbose]
//! Adapted from link-assistant/router's checker linked in issue #178.

#![cfg_attr(test, allow(dead_code))]

use std::fs;
use std::path::Path;
use std::process::exit;

/// A tool that is not on GitHub-hosted runners by default.
struct Tool {
    name: &'static str,
    /// Any of these in a non-comment line means the job runs the tool.
    uses: &'static [&'static str],
    /// Any of these in an earlier non-comment line installs it. A `tool:`
    /// input naming the tool (taiki-e/install-action, possibly in a
    /// comma-separated list) counts as an install too.
    installs: &'static [&'static str],
}

const TOOLS: &[Tool] = &[
    Tool {
        name: "rust-script",
        uses: &["rust-script ", "scripts/test-scripts.sh"],
        installs: &["cargo install rust-script", "install-rust-script.sh"],
    },
    Tool {
        name: "cargo-cyclonedx",
        uses: &["cargo cyclonedx", "cargo-cyclonedx "],
        installs: &["cargo install cargo-cyclonedx"],
    },
    Tool {
        name: "cargo-audit",
        uses: &["cargo audit", "cargo-audit "],
        installs: &["cargo install cargo-audit"],
    },
    Tool {
        name: "cargo-llvm-cov",
        uses: &["cargo llvm-cov", "cargo-llvm-cov "],
        installs: &["cargo install cargo-llvm-cov"],
    },
    Tool {
        name: "sccache",
        uses: &[
            "RUSTC_WRAPPER=sccache",
            "RUSTC_WRAPPER: sccache",
            "sccache ",
        ],
        installs: &["mozilla-actions/sccache-action@", "cargo install sccache"],
    },
];

/// A job's name and its lines, numbered from 1 within the workflow file.
#[derive(Debug, PartialEq)]
struct Job {
    name: String,
    lines: Vec<(usize, String)>,
}

/// Split a workflow into jobs: the two-space-indented keys under `jobs:`.
fn jobs(workflow: &str) -> Vec<Job> {
    let mut jobs = Vec::new();
    let mut in_jobs = false;
    for (index, line) in workflow.lines().enumerate() {
        if !line.starts_with(' ') && !line.trim().is_empty() && !line.starts_with('#') {
            in_jobs = line.trim_end() == "jobs:";
            continue;
        }
        if !in_jobs {
            continue;
        }
        let is_job_key = line.starts_with("  ")
            && !line.starts_with("   ")
            && !line.trim_start().starts_with('#')
            && line.trim_end().ends_with(':');
        if is_job_key {
            jobs.push(Job {
                name: line.trim().trim_end_matches(':').to_string(),
                lines: Vec::new(),
            });
        } else if let Some(job) = jobs.last_mut() {
            job.lines.push((index + 1, line.to_string()));
        }
    }
    jobs
}

fn is_comment(line: &str) -> bool {
    line.trim_start().starts_with('#')
}

/// Problems in one job: each tool used before (or without) its install.
fn missing_installs(job: &Job) -> Vec<String> {
    let mut problems = Vec::new();
    for tool in TOOLS {
        let installs_on = |line: &str| {
            tool.installs.iter().any(|marker| line.contains(marker))
                || line
                    .trim_start()
                    .strip_prefix("tool:")
                    .is_some_and(|tools| {
                        tools
                            .split(',')
                            .any(|item| item.trim().split('@').next() == Some(tool.name))
                    })
        };
        let first_install = job
            .lines
            .iter()
            .find(|(_, line)| !is_comment(line) && installs_on(line))
            .map(|(number, _)| *number);
        // `<tool> --version` only probes whether an install is still needed.
        let probes = |line: &str| {
            tool.uses
                .iter()
                .any(|marker| line.contains(&format!("{} --version", marker.trim_end())))
        };
        let first_use = job.lines.iter().find(|(_, line)| {
            !is_comment(line)
                && !installs_on(line)
                && !probes(line)
                && tool.uses.iter().any(|marker| line.contains(marker))
        });
        if let Some((number, line)) = first_use {
            match first_install {
                Some(install) if install < *number => {}
                Some(install) => problems.push(format!(
                    "job `{}` runs {} on line {number} before installing it on line {install}: {}",
                    job.name,
                    tool.name,
                    line.trim()
                )),
                None => problems.push(format!(
                    "job `{}` runs {} on line {number} but never installs it: {}",
                    job.name,
                    tool.name,
                    line.trim()
                )),
            }
        }
    }
    problems
}

fn main() {
    let verbose = std::env::args().any(|argument| argument == "--verbose")
        || std::env::var_os("CHECK_WORKFLOW_TOOLS_VERBOSE").is_some();
    let directory = Path::new(".github/workflows");
    let mut paths: Vec<_> = fs::read_dir(directory)
        .expect("failed to read .github/workflows")
        .map(|entry| entry.expect("workflow entry").path())
        .filter(|path| {
            matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("yml" | "yaml")
            )
        })
        .collect();
    paths.sort();

    let mut failures = Vec::new();
    let mut checked = 0;
    for path in &paths {
        let workflow = fs::read_to_string(path).expect("failed to read workflow");
        for job in jobs(&workflow) {
            checked += 1;
            let problems = missing_installs(&job);
            if verbose {
                eprintln!(
                    "[check-workflow-tools] {}: job `{}` ({} lines) -> {} problem(s)",
                    path.display(),
                    job.name,
                    job.lines.len(),
                    problems.len()
                );
            }
            failures.extend(
                problems
                    .into_iter()
                    .map(|problem| format!("{}: {problem}", path.display())),
            );
        }
    }

    if checked == 0 {
        eprintln!(
            "Error: no workflow jobs found under {}",
            directory.display()
        );
        exit(1);
    }
    if failures.is_empty() {
        println!(
            "every one of {checked} jobs in {} workflows installs the tools it runs",
            paths.len()
        );
    } else {
        for failure in failures {
            eprintln!("Error: {failure}");
        }
        exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORKFLOW: &str = "\
name: Example
on: push
jobs:
  first:
    steps:
      - run: cargo install rust-script --version 0.36.0 --locked
      - run: rust-script scripts/a.rs
  # A comment between jobs belongs to no job key.
  second:
    steps:
      # rust-script scripts/only-mentioned.rs
      - run: rust-script scripts/upload-release-assets.rs
";

    #[test]
    fn jobs_are_split_at_two_space_keys_under_jobs() {
        let names: Vec<_> = jobs(WORKFLOW).into_iter().map(|job| job.name).collect();
        assert_eq!(names, ["first", "second"]);
    }

    #[test]
    fn an_install_in_another_job_does_not_count() {
        let jobs = jobs(WORKFLOW);
        assert!(missing_installs(&jobs[0]).is_empty());
        let problems = missing_installs(&jobs[1]);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("job `second` runs rust-script on line 12"));
        assert!(problems[0].contains("never installs it"));
    }

    #[test]
    fn a_use_before_the_install_is_reported() {
        let workflow = "jobs:\n  late:\n    steps:\n      - run: cargo cyclonedx --format json\n      - run: cargo install cargo-cyclonedx --version 0.5.9 --locked\n";
        let problems = missing_installs(&jobs(workflow)[0]);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("before installing it on line 5"));
    }

    #[test]
    fn a_conditional_install_line_is_an_install_not_a_use() {
        let workflow = "jobs:\n  coverage:\n    steps:\n      - run: command -v rust-script >/dev/null || cargo install rust-script --version 0.36.0 --locked\n      - run: rust-script --test scripts/check-coverage.rs\n";
        assert!(missing_installs(&jobs(workflow)[0]).is_empty());
    }

    #[test]
    fn a_version_probe_before_the_install_is_not_a_use() {
        let workflow = "jobs:\n  coverage:\n    steps:\n      - run: |\n          if ! cargo llvm-cov --version 2>/dev/null | grep -Fqx 'cargo-llvm-cov 0.9.1'; then\n            cargo install cargo-llvm-cov --version 0.9.1 --locked --force\n          fi\n          cargo llvm-cov --workspace\n";
        assert!(missing_installs(&jobs(workflow)[0]).is_empty());
    }

    #[test]
    fn sccache_wrapper_requires_the_sccache_action_in_the_same_job() {
        let workflow = "jobs:\n  build:\n    steps:\n      - run: echo \"RUSTC_WRAPPER=sccache\" >> \"$GITHUB_ENV\"\n";
        let problems = missing_installs(&jobs(workflow)[0]);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("runs sccache"));
    }

    #[test]
    fn install_action_tool_lists_and_the_template_helper_count_as_installs() {
        let workflow = "jobs:\n  audit:\n    steps:\n      - uses: taiki-e/install-action@e67fa11c4b9316fa714ddf0abed07a0c3143b95b\n        with:\n          tool: cargo-llvm-cov, cargo-audit@0.22.2\n      - run: ./scripts/install-rust-script.sh\n      - run: cargo audit --deny warnings\n      - run: rust-script scripts/check.rs\n  other:\n    steps:\n      - uses: taiki-e/install-action@e67fa11c4b9316fa714ddf0abed07a0c3143b95b\n        with:\n          tool: cargo-audit-extra\n      - run: cargo audit\n";
        let jobs = jobs(workflow);
        assert!(missing_installs(&jobs[0]).is_empty());
        let problems = missing_installs(&jobs[1]);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("runs cargo-audit"));
    }

    #[test]
    fn top_level_keys_after_jobs_end_the_jobs_section() {
        let workflow = "jobs:\n  only:\n    steps: []\nenv:\n  NOT_A_JOB: x\n";
        let names: Vec<_> = jobs(workflow).into_iter().map(|job| job.name).collect();
        assert_eq!(names, ["only"]);
    }
    #[test]
    fn every_repository_job_installs_its_tools_and_deleting_any_helper_is_caught() {
        let directory = Path::new(file!())
            .parent()
            .unwrap()
            .join("../.github/workflows");
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if !matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("yml" | "yaml")
            ) {
                continue;
            }
            let workflow = fs::read_to_string(&path).unwrap();
            for job in jobs(&workflow) {
                assert!(
                    missing_installs(&job).is_empty(),
                    "{}: {:?}",
                    path.display(),
                    missing_installs(&job)
                );
                if job
                    .lines
                    .iter()
                    .any(|(_, line)| line.contains("run: ./scripts/install-rust-script.sh"))
                {
                    let mutated = Job {
                        name: job.name.clone(),
                        lines: job
                            .lines
                            .into_iter()
                            .filter(|(_, line)| {
                                !line.contains("run: ./scripts/install-rust-script.sh")
                            })
                            .collect(),
                    };
                    assert!(
                        !missing_installs(&mutated).is_empty(),
                        "{}: deleting {}'s installer must fail",
                        path.display(),
                        mutated.name
                    );
                }
            }
        }
    }
}
