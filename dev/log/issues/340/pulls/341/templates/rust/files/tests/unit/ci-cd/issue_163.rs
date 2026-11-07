//! Regression tests for issues #163 and #167.
//!
//! The release credentials were first exercised by the very step that
//! publishes -- 50 capped minutes into the run -- so a revoked token cost the
//! whole matrix before anyone learned the release could not happen (and the
//! answer arrived as a registry error in the middle of a long log). The
//! `release-preflight` job probes both credentials before the expensive jobs
//! spend their minutes: crates.io with an archive-free publish request that
//! verifies token/crate scopes, Docker Hub with an attempted blob-upload write (a
//! login -- or a token endpoint -- proves authentication, not
//! authorisation).

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::{Command, Output};
#[cfg(unix)]
use std::time::{SystemTime, UNIX_EPOCH};

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn release_yml() -> String {
    fs::read_to_string(repo_path(".github/workflows/release.yml"))
        .expect("release.yml should exist")
        .replace("\r\n", "\n")
}

fn job_block<'a>(workflow: &'a str, job: &str) -> &'a str {
    let marker = format!("  {job}:\n");
    let start = workflow
        .find(&marker)
        .unwrap_or_else(|| panic!("release.yml should declare the {job} job"));
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

#[cfg(unix)]
fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("issue-163-{name}-{nanos}"));
    fs::create_dir_all(&path).unwrap();
    path
}

/// An offline curl: answers each URL the preflight script probes with a
/// configurable verdict, so the behaviour tests never touch a network. The
/// response table is the environment (`FAKE_*` variables); the defaults are a
/// fully working credential set.
#[cfg(unix)]
fn write_curl_stub(dir: &Path) {
    let stub = r#"#!/usr/bin/env bash
method=GET; mode=body; url=''
args=("$@"); i=0
while [ $i -lt $# ]; do
  a="${args[$i]}"
  case "$a" in
    -X) method="${args[$((i+1))]}"; i=$((i+1)) ;;
    -D) mode=headers ;;
    http://*|https://*) url="$a" ;;
  esac
  i=$((i+1))
done
case "$url" in
  */token?*)
    printf '{"token":"fake-jwt","access":"pull"}\n200\n' ;;
  */blobs/uploads/*)
    if [ "$method" = DELETE ]; then exit 0; fi
    if [ "$mode" = headers ]; then
      printf 'HTTP/1.1 %s\r\nLocation: https://registry-1.docker.io/v2/%s/blobs/uploads/session-1\r\n\r\n' \
        "${FAKE_UPLOAD_STATUS:-202}" "${FAKE_IMAGE:-user/img}"
    else
      printf '{}\n%s\n' "${FAKE_UPLOAD_STATUS:-202}"
    fi ;;
  *)
    printf 'unexpected url: %s\n' "$url" >&2
    exit 1 ;;
esac
"#;
    let bin = dir.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::write(bin.join("curl"), stub).unwrap();
    fs::write(dir.join("fetch-stub.mjs"), r"
globalThis.fetch = async (url, request) => {
  if (!url.endsWith('/api/v1/crates/new') || request.method !== 'PUT') {
    throw new Error('unexpected publish probe');
  }
  const length = request.body.readUInt32LE();
  if (request.body.length !== 4 + length) throw new Error('archive must be absent');
  const status = Number(process.env.FAKE_CRATES_STATUS || 400);
  return { status, json: async () => ({errors: [{detail: process.env.FAKE_CRATES_DETAIL || 'invalid tarball length'}]}) };
};
").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(bin.join("curl"), fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[cfg(unix)]
struct PreflightRun {
    status: Output,
}

#[cfg(unix)]
fn run_preflight(workdir: &Path, env: &[(&str, &str)], mode: &str) -> PreflightRun {
    let fixture = temp_dir("run");
    write_curl_stub(&fixture);
    // The publish scope probe reads the selected crate from this manifest.
    fs::write(
        workdir.join("Cargo.toml"),
        "[package]\nname = \"test-crate\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();

    let script = repo_path("scripts/preflight-credentials.sh");
    let mut command = Command::new("bash");
    command
        .arg(script)
        .current_dir(workdir)
        .env("PREFLIGHT_MODE", mode)
        .env(
            "NODE_OPTIONS",
            format!("--import={}", fixture.join("fetch-stub.mjs").display()),
        )
        .env_remove("DOCKERHUB_IMAGE")
        .env(
            "PATH",
            format!(
                "{}:{}",
                fixture.join("bin").display(),
                std::env::var("PATH").unwrap()
            ),
        );
    for (key, value) in env {
        command.env(key, value);
    }

    PreflightRun {
        status: command.output().expect("preflight script should run"),
    }
}

#[cfg(unix)]
fn stdout(run: &PreflightRun) -> String {
    String::from_utf8_lossy(&run.status.stdout).into_owned()
}

#[cfg(unix)]
fn release_env() -> Vec<(&'static str, &'static str)> {
    vec![
        ("CARGO_REGISTRY_TOKEN", "cargo-token"),
        ("DOCKERHUB_IMAGE", "user/img"),
        ("DOCKERHUB_USERNAME", "user"),
        ("DOCKERHUB_TOKEN", "docker-token"),
    ]
}

/// The happy path: crates.io accepts the publish scope, and a
/// Docker Hub write the registry opens a session for.
#[cfg(unix)]
#[test]
fn a_working_credential_set_passes_in_release_mode() {
    let workdir = temp_dir("happy");
    let run = run_preflight(&workdir, &release_env(), "release");

    assert!(
        run.status.status.success(),
        "every probe succeeded: {}",
        stdout(&run)
    );
    let out = stdout(&run);
    assert!(
        out.contains("publish token and crate scope accepted"),
        "{out}"
    );
    assert!(
        out.contains("ownership is checked by the real publish"),
        "{out}"
    );
    assert!(out.contains("blob-upload write"), "{out}");
}

/// A revoked crates.io token fails the run in release mode -- that is the
/// entire point: learn it before the matrix, not after.
#[cfg(unix)]
#[test]
fn a_refused_cargo_token_fails_release_mode() {
    let workdir = temp_dir("cargo-403");
    let mut env = release_env();
    env.push(("FAKE_CRATES_STATUS", "403"));
    let run = run_preflight(&workdir, &env, "release");

    assert!(!run.status.status.success());
    assert!(stdout(&run).contains("publish token or crate scope rejected (403)"));
}

/// The probe cannot prove ownership. A scoped endpoint refusal is denied;
/// ownership remains the real publisher's responsibility (including teams).
#[cfg(unix)]
#[test]
fn a_token_without_publish_scope_is_a_failure() {
    let workdir = temp_dir("not-scoped");
    let mut env = release_env();
    env.push(("FAKE_CRATES_STATUS", "403"));
    let run = run_preflight(&workdir, &env, "release");
    assert!(!run.status.status.success());
    assert!(stdout(&run).contains("crate scope rejected"));
}

#[cfg(unix)]
#[test]
fn unknown_cargo_credentials_block_release_even_if_docker_is_verified() {
    let workdir = temp_dir("partial-unknown");
    let mut env = release_env();
    env.push(("FAKE_CRATES_STATUS", "503"));
    let run = run_preflight(&workdir, &env, "release");
    assert!(!run.status.status.success(), "{}", stdout(&run));
    assert!(stdout(&run).contains("UNKNOWN"));
    assert!(stdout(&run).contains("Docker Hub accepted"));
}

/// The measured Docker Hub behaviour: the token endpoint hands out a token
/// for a pull,push scope request, then the registry refuses the write. The
/// probe must catch what the login the publishing jobs run cannot.
#[cfg(unix)]
#[test]
fn a_login_success_with_a_refused_write_is_a_failure() {
    let workdir = temp_dir("docker-403");
    let mut env = release_env();
    env.push(("FAKE_UPLOAD_STATUS", "403"));
    let run = run_preflight(&workdir, &env, "release");

    assert!(!run.status.status.success());
    let out = stdout(&run);
    assert!(
        out.contains("Docker Hub refused the write"),
        "the write refusal must be named: {out}"
    );
}

/// Every failure is reported, not the first: both broken credentials are
/// named in one pass.
#[cfg(unix)]
#[test]
fn every_failure_is_reported_not_just_the_first() {
    let workdir = temp_dir("both-broken");
    let mut env = release_env();
    env.push(("FAKE_CRATES_STATUS", "403"));
    env.push(("FAKE_UPLOAD_STATUS", "403"));
    let run = run_preflight(&workdir, &env, "release");

    assert!(!run.status.status.success());
    let out = stdout(&run);
    assert!(out.contains("crates.io"), "{out}");
    assert!(out.contains("Docker Hub refused the write"), "{out}");
}

/// A 429 has not said the credential is broken. But a release that verified
/// nothing is not a pass either.
#[cfg(unix)]
#[test]
fn a_rate_limited_probe_is_unknown_and_release_mode_refuses_to_run_on_it() {
    let workdir = temp_dir("all-429");
    let mut env = release_env();
    env.push(("FAKE_CRATES_STATUS", "429"));
    env.push(("FAKE_UPLOAD_STATUS", "429"));
    let run = run_preflight(&workdir, &env, "release");

    assert!(
        !run.status.status.success(),
        "verified-nothing must fail release mode: {}",
        stdout(&run)
    );
    assert!(stdout(&run).contains("unknown"));

    let report = run_preflight(&workdir, &env, "report");
    assert!(
        report.status.status.success(),
        "report mode never blocks: {}",
        stdout(&report)
    );
}

/// Pull requests may come from forks without publishing secrets: the same
/// probes run, annotate, and never block.
#[cfg(unix)]
#[test]
fn report_mode_reports_but_never_blocks() {
    let workdir = temp_dir("report-mode");
    let mut env = release_env();
    env.push(("FAKE_CRATES_STATUS", "403"));
    env.push(("FAKE_UPLOAD_STATUS", "403"));
    let run = run_preflight(&workdir, &env, "report");

    assert!(
        run.status.status.success(),
        "report mode must not fail on broken credentials: {}",
        stdout(&run)
    );
    assert!(stdout(&run).contains("advisory"));
}

/// Docker publishing is optional in this template (`DOCKERHUB_IMAGE` unset
/// disables it everywhere else too) -- a skip is not a failure.
#[cfg(unix)]
#[test]
fn a_disabled_docker_path_is_a_skip_not_a_failure() {
    let workdir = temp_dir("docker-off");
    let env = vec![("CARGO_REGISTRY_TOKEN", "cargo-token")];
    let run = run_preflight(&workdir, &env, "release");

    assert!(run.status.status.success(), "{}", stdout(&run));
    assert!(stdout(&run).contains("SKIP"));
}

/// The job exists, runs first alongside the other entry jobs, and computes
/// its mode from the event -- release for push-to-main and the manual
/// instant release, report for everything else.
#[test]
fn release_yml_declares_the_preflight_job_with_the_mode_split() {
    let workflow = release_yml();
    let job = job_block(&workflow, "release-preflight");

    for required in [
        "timeout-minutes: 5",
        "persist-credentials: false",
        "bash scripts/preflight-credentials.sh",
        "github.event_name == 'push' && github.ref == 'refs/heads/main'",
        "github.event_name == 'workflow_dispatch' && github.event.inputs.release_mode == 'instant'",
        "'release' || 'report'",
    ] {
        assert!(
            job.contains(required),
            "release-preflight is missing {required:?}"
        );
    }
}

/// Every job that publishes declares the preflight and refuses to run on
/// anything but a verified pass -- skipped is not good enough (box#117: a
/// green run that published nothing).
#[test]
fn every_publishing_job_gates_on_a_verified_preflight() {
    let workflow = release_yml();

    for job in [
        "auto-release",
        "manual-release",
        "docker-publish",
        "docker-merge-manifest",
    ] {
        let block = job_block(&workflow, job);
        assert!(
            block.contains("release-preflight"),
            "{job} must declare release-preflight in needs"
        );
        assert!(
            block.contains("needs.release-preflight.result == 'success'"),
            "{job} must gate on the preflight verdict"
        );
    }
}

/// The terminal status gate observes the preflight too: a cancelled preflight
/// on main is exactly the hidden failure the gate exists to surface.
#[test]
fn the_status_gate_observes_the_preflight() {
    let workflow = release_yml();
    let gate = job_block(&workflow, "pipeline-status");

    assert!(
        gate.contains("release-preflight"),
        "pipeline-status must observe release-preflight"
    );
}
