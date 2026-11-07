# Issue 188: requirements, research and implementation

Reviewed 2026-10-07 against the prepared pull-request branch and its base,
`e7d4a5bceb152f76d9fde77bae6751b835b9cdcd162`. The umbrella issue asks for
every open issue to be investigated and fixed, or closed if already addressed,
with a separate closing keyword for every issue in the pull request. All eleven
linked issues still required changes. Issue descriptions and all issue comments
were read; the three pull-request comment/review endpoints contained no feedback.

## Execution plan

1. Read issues 177–188, comments, contributing rules, recent merged pull requests and the existing workflows.
2. Map every requirement to all affected scripts, workflows, documentation and policy tests.
3. Check upstream documentation and source, including downstream implementations, before choosing components.
4. Reproduce behavioral defects in offline fixtures, then implement and run their regressions.
5. Run all local CI checks, review the complete diff and incorporate the default branch.
6. Commit the changes, push only the prepared branch and replace the draft PR title/description.
7. Verify CI timestamps and SHAs, preserve failed logs, fix failures, and mark PR 189 ready.

## Complete requirement and solution map

### 177 — Cargo publication credentials

- Requirement: remove deprecated `cargo publish --token` and keep the credential out of the child process arguments; preserve existing token inputs.
- Alternatives: credential login writes persistent state; a child environment variable needs no persistent configuration.
- Chosen plan: retain the script's CLI/environment compatibility, but pass the resolved secret through child `CARGO_REGISTRY_TOKEN` in `publish-crate.rs`.
- Verification: fake Cargo captures arguments and environment; the token is absent from argv and present in the expected environment variable.

Cargo documents the environment variable for publishing credentials. [Cargo publish](https://doc.rust-lang.org/cargo/commands/cargo-publish.html)

### 178 — Install tools in each job

- Requirement: inspect every job separately, require installation before first real use, and detect `rust-script`, `cargo-llvm-cov`, `cargo-audit`, `cargo-cyclonedx` and `sccache` via `RUSTC_WRAPPER`.
- Requirement: recognise the existing retrying helper and `taiki-e/install-action` tool lists; ignore comments, version probes and conditional installation lines.
- Requirement: run this check in `workflows.yml` and prevent deletion of one job's installation from being hidden by another job's installation.
- Alternatives: a full YAML parser supports more syntax but adds bootstrap dependencies; the downstream standard-library checker fits this repository's two-space job format.
- Chosen plan: adapt Router's checker, add a required workflow job compiled directly with `rustc`, and run it whenever workflow configuration or its source changes.
- Verification: original eight parsing/order regressions, every current workflow, and mutations deleting each individual rust-script helper installation.

The existing component was linked in [Router issue 648](https://github.com/link-assistant/router/issues/648). The install action supports explicit versions and tool lists. [Install action documentation](https://github.com/taiki-e/install-action/blob/main/README.md)

### 179 — Reproducible rust-script

- Requirement: pin rust-script itself, retain locked dependencies and retries, replace a different cached version, and assert the version in tests.
- Alternatives: pinned prebuilt `taiki-e/install-action` is faster; retaining the established helper preserves its retry behavior and downstream compatibility.
- Chosen plan: default to `0.36.0`, match the entire version string, and install with `--version`, `--locked`, and `--force`; use the helper in developer instructions too.
- Verification: exact cached version avoids installation; `0.136.0` does not match `0.36.0`; replacement uses the complete pin; three failures produce a failure exit.

`--locked` selects published dependency resolution, while `--version` selects the package release. [Cargo install](https://doc.rust-lang.org/cargo/commands/cargo-install.html)

### 180 — Runner OS labels

- Requirement: replace all 34 Ubuntu alias uses across five workflows, including matrix values; guard against reintroduction and make future OS upgrades reviewed changes.
- Optional requirement adopted: replace `macos-latest` with `macos-26`.
- Alternatives: accept the alias migration or freeze a named image; freezing meets the requested reproducibility goal.
- Chosen plan: use `ubuntu-24.04` throughout and pin the macOS test matrix while retaining existing explicit desktop platform labels.
- Verification: inspect every workflow's non-comment lines; no floating Ubuntu/macOS label is permitted.

GitHub's migration notice schedules the Ubuntu alias change for October 19–November 19, 2026. [Runner image migration](https://github.com/actions/runner-images/issues/14748)

### 181 — Cargo warnings must fail

- Requirement: make Cargo's own manifest/build-target warnings fatal even when the Cargo command exits successfully; preserve actual Cargo failures.
- Alternatives: rustc lint settings cannot cover Cargo's own messages; inspecting color-free command output covers both reported examples.
- Chosen plan: reusable `check-cargo-warnings.sh` runs locked all-target/all-feature checking with `pipefail`, preserves output with `tee`, and rejects warning lines. Invoke it in both lint and fresh-merge simulation.
- Verification: an unused manifest key and duplicate binary target path fail; the original command with the unused key succeeds; a mock Cargo exit 23 remains exit 23.

### 182 — Version and fragment guards

- Requirement: remove branch-prefix exemptions, allow formatting-only version edits, compare parsed package versions, and require a genuinely new fragment.
- Requirement: preserve root/nested/workspace detection and fail on invalid TOML or unavailable comparison bases.
- Alternatives: line matching misclassifies formatting and misses workspace inheritance; a TOML parser compares semantic values.
- Chosen plan: use `toml::Value` to compare `[package].version` and `[workspace.package].version` in changed existing manifests at merge-base and HEAD. Normalize absolute and dotted Rust roots to Git paths. Require `--diff-filter=A` and a top-level `.md` fragment that the collector actually consumes; member source and manifest changes are covered too.
- Verification: release-prefix bypass, formatting/dependency edits, workspace member/inherited versions, absolute/dotted roots, invalid TOML, editing existing fragments, nested/workspace source, uncollectable subdirectory fragments and missing bases.

The parser's public API directly represents TOML values. [TOML parser](https://docs.rs/toml/0.8.23/toml/)

### 183 — Scoped crates.io credential preflight

- Requirement: stop using the cookie-only account endpoint; nonempty tokens alone must not count as proof.
- Requirement: use valid length-prefixed publish metadata, omit both archive length and archive bytes, accept only HTTP 400 with exactly one `invalid tarball length` error, and classify every other response as denied/unknown without logging secrets.
- Requirement: describe the ownership limitation; actual publication checks ownership later, including teams.
- Alternatives: account endpoints reject scoped API tokens; dry-run publication does not exercise the remote handler; the metadata-only request reaches authentication/scopes without supplying an archive.
- Chosen plan: native Node fetch helper for the actual `PUT /api/v1/crates/new` endpoint. Keep report mode advisory, but block release mode if any configured registry remains unknown, even when another registry was verified. Preserve the existing Docker write-and-cancel probe.
- Verification: valid binary structure, exact error matching, malformed responses, denied/rate-limited/server/network cases, no token in diagnostics, and shell orchestration with Docker results.
- Limit: source tracing and mocks verify the protocol. No successful live authenticated publication probe is claimed; scope/email verification still does not prove ownership.

The account route requires cookie authentication. The publish handler validates token endpoint/crate scope and verified email before archive length, then checks ownership later. [Account handler](https://github.com/rust-lang/crates.io/blob/main/src/controllers/user/me.rs), [publish handler](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/publish.rs)

### 184 — Release index isolation

- Requirement: reject unrelated prestaged, modified, deleted and untracked paths anywhere in the repository without discarding work.
- Requirement: allow only the selected manifest, Cargo.lock, CHANGELOG.md, consumed top-level fragments and benchmark Cargo.lock; support root/nested packages and native subprocess arguments/NUL-delimited paths.
- Requirement: retain the already-correct tag creation after successful push/rebase retries.
- Alternatives: named `git add` does not restrict a later commit's complete index; a temporary index would not detect unrelated working changes. Validate the actual index and working tree instead.
- Chosen plan: `release-index.rs` constructs the metadata allowlist and validates before release mutation, before staging and before commit. Include tracked fragments already deleted from disk. The manual writer collects fragments itself after validation.
- Verification: temporary Git repositories cover root/nested roots, spaces/newlines, staged/untracked and other-language preservation, README rejection, selected workspace manifests, deleted fragments and benchmark locks. A committed allowed release contains only allowed paths.

### 185 — Doc tests once

- Requirement: remove the duplicate doc-test command and its budget, or split targets with matching features so each runs once.
- Alternatives: split target groups retain separate budgets; the existing all-feature suite already supplies doc-test coverage.
- Chosen plan: remove the extra step and `DOC_TEST_BUDGET_SECONDS`; document that the main suite includes doc tests.
- Verification: workflow regression requires the all-feature suite and rejects the extra command/budget; the local suite's output includes `Doc-tests`.

Cargo runs documentation tests by default. [Cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html)

### 186 — Workflow security and scanner pins

- Requirement: scan at low confidence, resolve all twelve exposed findings, make the two writer checkouts explicitly persist credentials, and allow persistence only in serialized main writers.
- Requirement: route every shell-interpolated step output through quoted environment variables; use action `v0.6.4` with analyzer `1.30.1` consistently in regular/pedantic runs and reproduction instructions.
- Requirement: pin secretlint and its recommended preset to `13.0.7`.
- Alternatives: suppressing the new findings conceals future defects; explicit intent and safe shell values satisfy the existing scanner.
- Chosen plan: update both writer jobs and all affected wait, smoke-test, metadata, release and digest commands; raise scanner coverage and pin packages.
- Verification: regular low-confidence and pedantic high-severity/high-confidence Zizmor passes, Actionlint with ShellCheck, checkout concurrency/persistence policies and version assertions.

Explicit persistence makes checkout intent auditable. [Zizmor artipacked audit](https://docs.zizmor.sh/audits/#artipacked)

### 187 — Links, CodeQL and propagation margin

- Requirement: throttle GitHub requests and include `lychee.toml` in both workflow path filters.
- Requirement: handle temporary 429 and 5xx failures without hiding permanent broken links. The issue's correction records one GitHub 429, two GitHub 502s and four CodeFactor 503s, rather than seven GitHub-only failures.
- Alternatives: accepting 429 globally hides persistent failures; excluding URLs hides genuine dead pages; bounded retry with backoff preserves useful failure signals.
- Chosen plan: GitHub concurrency 2 and interval 1s; classify both numeric and rejected-status reports, retry unanswered/429/all-5xx URLs sequentially under the existing total budget, and keep 404 final. Cancel response bodies and cap individual requests to remaining budget.
- Requirement: exclude experiments from CodeQL using a configuration file honored by Rust extraction.
- Chosen plan: explicit `build-mode: none` and `.github/codeql/codeql-config.yml` with `paths-ignore: experiments`; remove unnecessary autobuild.
- Requirement: increase default crates.io wait toward ten minutes.
- Chosen plan: 40 attempts, 15 seconds apart, preserving override options and workflow deadlines.
- Verification: unit/local-server recovery for 429/500/502/503/504, bounded persistent 503, mixed recovered/permanent failure verdicts, path-filter/config assertions and wait-default assertions.

Lychee exposes per-host controls, and its rejected-status retry branch treats 429 differently from rejected 5xx. [Lychee configuration](https://github.com/lycheeverse/lychee/blob/master/lychee.example.toml), [retry source](https://github.com/lycheeverse/lychee/blob/master/lychee-lib/src/retry.rs). GitHub documents no-build Rust extraction and exclusions for that mode. [CodeQL build modes](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-for-compiled-languages), [analysis exclusions](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/alerts-in-generated-code)

## Reproduction evidence and reusable checks

Before implementation, isolated CLI fixtures reported seven failures out of ten,
including the branch bypass, formatting rejection, reused fragment, workspace
version omission, wrong cached tool version and token in Cargo arguments. Five
new transient-status recovery cases failed. Removing only the changelog job's
installation made the per-job checker identify that exact job. Low-confidence
Zizmor exposed ten informational injection findings and two credential findings.
The warning fixture also establishes that Cargo can exit zero while printing a
manifest warning. These are finite, offline tests; no archive is published.

Permanent checks are in `experiments/issue-188-regressions.py`, inline Rust
tests, `tests/unit/ci-cd/issue_188.rs`, and the Node test suites. The existing
`scripts/test-scripts.sh` now executes the CLI and Node checks too, keeping them
in the required release gate. No new runtime dependency is added to the crate;
the TOML library belongs only to the version-check script.

Local validation passed 264 crate tests, 110 inline script tests, 16 CLI
regressions and 48 Node tests. Formatting, Clippy with denied warnings, rustdoc,
the Cargo-warning gate, source/documentation size limits, package size,
Actionlint with ShellCheck, pinned secretlint and both Zizmor personas passed.
The tool checker inspects 35 jobs in all five workflows after adding its own job.
The two pre-existing grandfathered Rust files remain at their existing line caps.

Run local validation with:

```bash
cargo fmt --all --check
RUSTFLAGS=-Dwarnings cargo clippy --all-targets --all-features -- -Dwarnings
RUSTFLAGS=-Dwarnings cargo test --all-features
./scripts/test-scripts.sh
bash scripts/check-cargo-warnings.sh
rust-script scripts/check-file-size.rs
rustc scripts/check-workflow-tools.rs -o /tmp/check-workflow-tools
/tmp/check-workflow-tools --verbose
actionlint
zizmor --config .github/zizmor.yml --min-confidence low .github/workflows
```

## Repository-wide review and release trigger

The audit covers all five workflows, both release writers, lint and fresh-merge
paths, helper consumers, documentation installation commands and existing policy
tests. Versions and root Cargo.lock remain unchanged: the newly added patch
fragment is the repository's release trigger, and the automated writer owns the
subsequent version bump. Existing tag ordering, Docker credential probing, native
desktop targets, release gating and configurable retry budgets are retained.

## CI investigation and action provenance

The first complete CI run used commit `4f8057f` at 2026-10-07 02:06:43 UTC.
The main pipeline gates, links, security and all six desktop builds passed.
Code-gated jobs were skipped for that documentation-only commit; the follow-up
includes a Rust policy test so those jobs run against the final source tree. The
Workflows audit failed: `ci-logs/workflows-37560398405.log`, lines 269–284,
reported 16 Rust action references with no history in the referenced repository.
The offline local audit cannot perform this GitHub ancestry check.

The existing `6bed0761...` pin came from the generated `stable` branch.
GitHub's compare API confirmed it had diverged from `master` by one commit.
Upstream explicitly requires full SHA pins from `master` history, because
generated branch commits eventually become unreachable. Replace all 16 uses
with verified master commit `7e38f4b43b4db5c8dd498af069a4f6196df1d067`,
retaining the explicit `toolchain: stable` inputs. A new repository-wide policy
test fails on the old pin before replacement. Validate both Zizmor personas with
authenticated online audits as well as the normal local checks.
[Upstream pinning requirements](https://github.com/dtolnay/rust-toolchain#choice-of-full-length-commit-sha),
[verified upstream commit](https://github.com/dtolnay/rust-toolchain/commit/7e38f4b43b4db5c8dd498af069a4f6196df1d067)
