# CI/CD Troubleshooting Guide

This guide covers common CI/CD issues and their solutions for Rust projects using this template.

## Table of Contents

1. [Release Jobs Skipped](#release-jobs-skipped)
2. [Version Already Released (False Positive)](#version-already-released-false-positive)
3. [Missing Committed Cargo.lock](#missing-committed-cargolock)
4. [Transient Cargo Registry Download Failures](#transient-cargo-registry-download-failures)
5. [Crates.io Publishing Fails](#cratesio-publishing-fails)
6. [Crate Package Too Large (HTTP 413)](#crate-package-too-large-http-413)
7. [Docker Hub Publishing Fails](#docker-hub-publishing-fails)
8. [Secret Configuration Issues](#secret-configuration-issues)
9. [Multi-Language Repository Issues](#multi-language-repository-issues)
10. [Hosted Runner Not Acquired](#hosted-runner-not-acquired)

---

## Release Jobs Skipped

### Symptom
Release jobs (auto-release or manual-release) are skipped even though you expected them to run.

### Common Causes

#### 1. Upstream job was skipped
When a job like `detect-changes` is skipped (e.g., on `workflow_dispatch`), all dependent jobs are also skipped by default.

**Solution:** Ensure dependent jobs use `always() && !cancelled()` in their conditions:
```yaml
if: |
  always() && !cancelled() && (
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    needs.detect-changes.outputs.rs-changed == 'true'
  )
```

#### 2. Build or test failed
Release jobs depend on `build` which depends on `lint` and `test`. If any of these fail, release jobs won't run.

**Solution:** Check the logs for lint, test, and build jobs. Fix any failures before releasing.

#### 3. Wrong trigger condition
The job condition may not match your trigger event.

**Solution:** Verify the job's `if` condition matches your trigger:
- `github.event_name == 'push'` for automatic releases on merge
- `github.event_name == 'workflow_dispatch'` for manual triggers

### Reference
- [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491)

---

## Version Already Released (False Positive)

### Symptom
The release workflow says "version already released" but the package is not actually on crates.io.

### Root Cause
The workflow was checking git tags instead of crates.io. Git tags can exist without the package being published (e.g., from previous GitHub-only releases).

### Solution
This template now checks crates.io directly using the API:
```javascript
const response = await fetch(
  `https://crates.io/api/v1/crates/${crateName}/${version}`
);
const isPublished = response.ok && (await response.json()).version;
```

### Verification
Check if your package exists on crates.io:
```bash
curl -s "https://crates.io/api/v1/crates/YOUR_CRATE_NAME" | jq
```

### Reference
- [browser-commander Issue #29](https://github.com/link-foundation/browser-commander/issues/29)

---

## Missing Committed Cargo.lock

### Symptom
The `Cargo.lock Guard` job fails with an error like:

```
Binary package ./Cargo.toml requires a committed ./Cargo.lock
```

or:

```
Binary package ./Cargo.toml has ./Cargo.lock, but it is not committed at HEAD
```

### Root Cause
The package has a binary target (`[[bin]]` or `src/main.rs`), but `Cargo.lock`
is missing from the committed repository state. Binary crates should commit the
lockfile so CI, releases, and downstream installs use a deterministic dependency
graph.

Without a committed lockfile, GitHub Actions cache keys such as
`hashFiles('**/Cargo.lock')` degrade to the same empty hash. That can cache an
unpinned dependency graph and let dependency re-resolution drift appear only in
fresh or cache-less jobs.

### Solution
Generate and commit the lockfile:

```bash
cargo generate-lockfile
git add Cargo.lock
git commit -m "chore: commit Cargo.lock"
```

For a multi-language repository where Rust lives under `rust/`, commit
`rust/Cargo.lock` instead.

Library-only crates can leave `Cargo.lock` uncommitted. If the package contains
`src/main.rs` only for local development, set `autobins = false` in `[package]`
or remove the binary target.

### Verification
Run the guard locally:

```bash
rust-script scripts/check-cargo-lock.rs
```

---

## Transient Cargo Registry Download Failures

### Symptom
Cargo fails while updating the crates.io registry or downloading a crate with a
transient network error, for example:

```
curl failed
[16] Error in the HTTP2 framing layer
```

### Root Cause
GitHub-hosted runners occasionally hit transient registry, CDN, or HTTP/2
transport failures. These errors can affect any workflow step that invokes
Cargo, including `cargo install`, `cargo build`, `cargo test`, `cargo publish`,
and `cargo metadata`.

### How This Template Prevents It
The workflow sets Cargo network options at top-level `env` so all Cargo commands
inherit them:

```yaml
CARGO_NET_RETRY: '10'
CARGO_HTTP_MULTIPLEXING: 'false'
```

`CARGO_NET_RETRY` increases retry attempts for network operations.
`CARGO_HTTP_MULTIPLEXING=false` disables libcurl HTTP multiplexing, which avoids
the HTTP/2 framing failure mode while keeping the rest of Cargo's registry
behavior unchanged.

### Solution
If a downstream repository has copied an older workflow, add the same top-level
environment variables near the existing Cargo settings:

```yaml
env:
  CARGO_TERM_COLOR: always
  RUSTFLAGS: -Dwarnings
  CARGO_NET_RETRY: '10'
  CARGO_HTTP_MULTIPLEXING: 'false'
```

---

## Crates.io Publishing Fails

### Symptom
The "Publish to Crates.io" step fails with an error.

### Common Errors

#### "please provide a non-empty token"
**Cause:** The `CARGO_REGISTRY_TOKEN` environment variable is empty or not set.

**Solution:**
1. Ensure you have a secret configured (either `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN`)
2. Map the secret correctly in your workflow:
```yaml
- name: Publish to Crates.io
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
  run: node scripts/publish-crate.mjs
```

#### "already uploaded" or "already exists"
**Cause:** This version was already published to crates.io.

**Note:** This is handled gracefully by the script and is not a failure.

#### "unauthorized" or authentication errors
**Cause:** Invalid or expired token.

**Solution:**
1. Generate a new token at https://crates.io/settings/tokens
2. Update the secret in your repository or organization settings

### Reference
- [browser-commander Issue #33](https://github.com/link-foundation/browser-commander/issues/33)
- [Cargo Publishing Documentation](https://doc.rust-lang.org/cargo/reference/publishing.html)

---

## Crate Package Too Large (HTTP 413)

### Symptom
`cargo publish` is rejected by crates.io with:

```
error: failed to publish to registry
the remote server responded with an error (status 413 Payload Too Large):
max upload size is 10485760
```

### Root Cause
The generated `.crate` archive exceeds the crates.io upload limit of **10 MiB
(10485760 bytes)**. This usually happens when documentation, case studies,
generated CI artifacts, datasets, or experiment files are silently bundled into
the package.

### How This Template Prevents It

#### 1. Pre-publish size guard
`scripts/check-crate-size.rs` builds the `.crate` archive and fails the workflow
**before** publishing when the archive is over the limit. It runs in the `build`
job (early PR feedback) and again right before the publish step in both the
`auto-release` and `manual-release` jobs.

Run it locally before pushing:
```bash
rust-script scripts/check-crate-size.rs
```

#### 2. Narrow `include` allowlist
`Cargo.toml` declares an `include` list so only the crate sources and a few
documentation files ship in the release archive:
```toml
include = [
    "src/**/*.rs",
    "examples/**/*.rs",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
]
```

### Solution When the Guard Fails
1. Inspect what is being packaged:
   ```bash
   cargo package --list --allow-dirty
   ```
2. Tighten the `include` allowlist in `Cargo.toml` (or add an `exclude` list) to
   drop large files such as docs, datasets, generated logs, and experiments.
3. Re-run the size guard to confirm the archive is under 10 MiB.

### Reference
- [Cargo `include`/`exclude` fields](https://doc.rust-lang.org/cargo/reference/manifest.html#the-exclude-and-include-fields)
- [Cargo packaging documentation](https://doc.rust-lang.org/cargo/reference/publishing.html#packaging-a-crate)

---

## Docker Hub Publishing Fails

### Symptom
The crates.io publish succeeds, but the release workflow fails before or during Docker Hub publishing.

### Required Configuration

Docker Hub publishing is optional. It runs only when all of these are true:

- A root `Dockerfile` exists
- Repository variable `DOCKERHUB_IMAGE` is set to `namespace/repository`
- `DOCKERHUB_USERNAME` is set as a repository variable or secret
- Repository secret `DOCKERHUB_TOKEN` is set

### Common Errors

#### "Docker Hub publishing requires DOCKERHUB_USERNAME and DOCKERHUB_TOKEN"
**Cause:** `DOCKERHUB_IMAGE` and `Dockerfile` enabled Docker publishing, but credentials are incomplete.

**Solution:** Set `DOCKERHUB_USERNAME` and create a Docker Hub access token stored as `DOCKERHUB_TOKEN`.

#### Docker tag is missing after crates.io already published
**Cause:** A previous release run published the crate, then failed before Docker Hub or GitHub Release completed.

**Solution:** Re-run the release workflow after fixing the Docker Hub configuration. The release check treats the version as incomplete and recreates missing artifacts without bumping the Cargo version again.

### Verification
Check whether a Docker Hub tag exists:

```bash
curl -fsSL "https://hub.docker.com/v2/repositories/NAMESPACE/REPOSITORY/tags/VERSION"
```

### Reference
- [Docker GitHub Actions guide](https://docs.docker.com/build/ci/github-actions/)

---

## Secret Configuration Issues

### Required Secrets

| Secret Name | Purpose | Where to Get |
|------------|---------|--------------|
| `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN` | Publish to crates.io | https://crates.io/settings/tokens |
| `DOCKERHUB_TOKEN` | Publish to Docker Hub when `DOCKERHUB_IMAGE` is configured | https://docs.docker.com/security/access-tokens/ |
| `GITHUB_TOKEN` | Create GitHub releases | Automatic (provided by GitHub) |

### Organization vs Repository Secrets

If using organization secrets with different names, map them on the step that
publishes — not in the workflow-level `env:`, which is inherited by every job,
including the `pull_request` jobs that compile and run code from the branch
under review:
```yaml
- name: Publish to Crates.io
  env:
    # Map organization secret to the expected variable name
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
  run: rust-script scripts/publish-crate.rs
```

### Checking Secret Values

Secrets are masked in logs, but you can verify they're set:
```yaml
- name: Debug secrets
  run: |
    if [ -n "$CARGO_REGISTRY_TOKEN" ]; then
      echo "CARGO_REGISTRY_TOKEN is set (value masked)"
    else
      echo "WARNING: CARGO_REGISTRY_TOKEN is NOT set"
    fi
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

### Reference
- [GitHub Actions Secrets Documentation](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions)

---

## Multi-Language Repository Issues

### Symptom
Scripts fail to find `Cargo.toml` or run in the wrong directory.

### Solution
This template auto-detects the repository structure:
- **Single-language:** `Cargo.toml` in repository root
- **Multi-language:** `Cargo.toml` in `rust/` subfolder

If auto-detection fails, you can explicitly configure the Rust root:
```bash
# Via environment variable
RUST_ROOT=rust node scripts/publish-crate.mjs

# Via CLI argument
node scripts/publish-crate.mjs --rust-root rust
```

### Workflow Configuration
For multi-language repos, ensure your workflow has the correct `working-directory`:
```yaml
defaults:
  run:
    working-directory: rust

steps:
  - name: Publish to Crates.io
    working-directory: .  # Override for scripts that handle paths themselves
    run: node rust/scripts/publish-crate.mjs
```

### Reference
- [browser-commander Issue #31](https://github.com/link-foundation/browser-commander/issues/31)

---

## Hosted Runner Not Acquired

### Symptom

A job (usually a macOS arm64 leg such as `Build macos-arm64`) ends `cancelled`
or `failed` with no steps and an empty runner name, and carries the annotation
"The job was not acquired by Runner of type hosted even after multiple
attempts". Pipeline Status fails and, on `main`, the release is skipped.

### Root Cause

GitHub ran out of hosted capacity for that runner label and gave up on the
queued job. No code ran, so the failure says nothing about the change.

### How This Template Handles It

- `scripts/check-pipeline-status.sh` still fails the run, because nothing was
  tested, but adds a `Hosted runner not acquired` error naming those jobs.
- `.github/workflows/rerun-infrastructure-failures.yml` watches every workflow
  with a Pipeline Status gate. When a run fails and at least one job matches
  all of: conclusion `cancelled`/`failure`, no steps, no runner and the "not
  acquired" annotation, it runs `gh run rerun <run-id> --failed`, which also
  re-evaluates the release and status gates. It reruns attempts 1 and 2 only,
  skips runs that a newer run of the same workflow and branch has superseded,
  and never reruns a job that ran steps. On attempt 3 it reports an error with
  the manual command instead.

The decision lives in `scripts/unacquired-jobs.py` (offline tests:
`experiments/issue-226-regressions.py`). Set the repository variable
`UNACQUIRED_JOBS_VERBOSE=1` for a trace. To check a run by hand:

```bash
python3 scripts/unacquired-jobs.py rerun --dry-run \
  --repository owner/repo --run-id <run-id> --attempt <attempt>
```

### Solution When Retries Are Exhausted

Wait for capacity and run
`gh run rerun <run-id> --failed --repo owner/repo`.

---

## General Debugging Tips

### 1. Check Job Dependencies
View the workflow graph in GitHub Actions to see which jobs depend on which.

### 2. Download Full Logs
```bash
gh run view <run-id> --repo owner/repo --log > ci-logs.txt
```

### 3. Enable Debug Logging
Add this secret to enable debug logging:
- Name: `ACTIONS_STEP_DEBUG`
- Value: `true`

### 4. Check crates.io Status
Sometimes crates.io has issues. Check: https://status.crates.io/

### 5. Verify Package Locally
Before pushing, verify your package builds and passes checks:
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features
cargo package --list
rust-script scripts/check-crate-size.rs
```
