# Root causes

Each defect: symptom → evidence → root cause → fix → test. "FP" marks a false positive (red without a real defect), "FN" a false negative (green while something is wrong), "W" a warning.

## D1 (FP): macOS unit test killed one second early

- **Symptom:** `run-with-budget-warning.sh > warns while the overrun can still be acted on` expected exit 0 and got 124 after 3091 ms on `macos-latest`. The JS Pipeline Status gate failed and the release of #334 was skipped.
- **Root cause:** bash's `SECONDS` counts wall-clock second _boundaries_. A deadline written as `SECONDS -ge budget` can therefore fire after only `budget - 1 + ε` seconds. The test ran a 2 s sleep under a 3 s budget, started just before a boundary, and the wrapper killed it at about 2.9 s. Slow macOS runners hit the window more often. The same `-ge` comparison exists in all three templates.
- **Fix:** `d274daa` makes the deadlines require `SECONDS -gt budget`. It also ports the JS template's hardened wrapper: process-group liveness, a SIGKILL wait, a survivor report, and `BUDGET_VERBOSE` tracing.
- **Test:** `js/tests/run-with-budget-warning.js` includes a deterministic test that starts just before a second boundary. `experiments/issue-337/budget-early-kill.mjs` reproduces the early kill. Upstream: js#252, rust#213, python#116.

## D2 (FN, W): Rust lint passed with clippy and rustdoc warnings

- **Evidence:** the `Lint and Format Check` log shows `needless_borrows_for_generic_args` and `sort_by_key` warnings on a green job.
- **Root cause:** `rust.yml` did not set `RUSTFLAGS=-Dwarnings`, and `cargo doc` ran without `RUSTDOCFLAGS=-D warnings`.
- **Fix:** `e978601` sets both, fixes the warnings, and adds `check-cargo-warnings.sh` from the Rust template for manifest warnings.

## D3 (FP/FN): the changeset check counted every changeset on disk

- **Root cause:** D1 skipped the release, so the `minor` changeset of #334 stayed in `js/.changeset/`. `validate-changeset.mjs` counted every file in the directory. From then on a PR without a changeset passed (FN), and a PR adding one failed with "Multiple changesets found" (FP).
- **Fix:** `3296fd4` counts only the files the pull request adds, diffed against the base branch. The Rust fragment check got the same treatment in `e978601`.
- **Test:** `js/tests/validate-changeset.js`.

## D4 (FN): the release stays unreleased silently

npm still published `0.26.15` after #334. That is the consequence of D1, not a separate defect: the gate was red, so the skip was visible. With D1 fixed, the next main push releases the pending changeset.

## D5 (W): `npm warn EBADENGINE` for `@opentui/core`

- **Root cause:** `@opentui/core@0.6.6` requires `node: '>=26.4.0'`, but CI installed with Node 24.
- **Fix:** `3b91041` moves every `setup-node` to `26.x`.

## D6 (W, FN): `node-pty@1.1.0` install script not covered by `allowScripts`

- **Root cause:** the pin named `node-pty@1.2.0-beta.15`, while the lockfile resolves `1.1.0`. npm warned and skipped the install script.
- **Fix:** `3b91041` refreshes the pin. `js/.npmrc` sets `strict-allow-scripts`, so the next drift fails the install instead of warning.

## D7 (W, FN): AI SDK `generateObject` deprecation; warning tests that could not fail

- **Root cause:** AI SDK 7 deprecates `generateObject` and reports warnings through `process.emitWarning`. The tests that asserted warning-free requests mocked `console.warn`, so they never saw a warning.
- **Fix:** `82dd256` switches to `generateText` + `Output.object` and captures warnings through `AI_SDK_LOG_WARNINGS`. A self-check proves the capture sees a real warning.
- **Test:** `js/tests/ai-sdk-warnings.ts`.

## D8 (FP annotation): `##[error] No Trusted Publishing config` on a green Rust release

- **Root cause:** `crates-io-auth-action` ran unconditionally. crates.io has no trusted publisher configured for this repository, so the step logged an error. The job then published with `CARGO_REGISTRY_TOKEN` and stayed green.
- **Fix:** `e978601` runs the action only when the `CRATES_IO_TRUSTED_PUBLISHING` variable is `true`, and a notice explains the token fallback. Turning trusted publishing on needs a human action ([`open-findings.md`](open-findings.md)).

## D9 (W): lychee `[WARN] ./**/*.html: No files found`

- **Fix:** `b47eb8b` uses a directory input with `--extensions md,html`. It checks the same files, honours `.gitignore`, and stays quiet.

## D10 (FN): Instant Release published without the quality gates

- **Root cause:** `instant-release` in `js.yml` had no `needs` on lint or test, so a manual instant release could publish a commit whose tests failed.
- **Fix:** `4d78b23` makes it need `lint`, `test`, `verbose-integration` and `package-install`, and requires success of each.
- **Test:** the "release gating" block of `js/tests/workflow-policy.js` covers all four release jobs of `js.yml` and `rust.yml`.

## D11 (FN): an instant release ended green without releasing when main moved

- **Root cause:** `version-and-commit.mjs` read "origin/main ahead + no changesets" as "an earlier attempt already released". Instant mode never has changesets, so on a _first_ attempt that overlapped another merge, the job skipped the publish and still passed.
- **Fix:** `4d78b23` adds `scripts/release-rerun.mjs`. In instant mode, only a rerun (`GITHUB_RUN_ATTEMPT > 1`) is treated as finishing an earlier attempt.
- **Test:** the "release rerun detection" block of `js/tests/ci-scripts.js`.

## D12 (FN): the gate hid cancelled and timed-out jobs

- **Root cause:** off main, `check-pipeline-status.sh` downgraded every cancelled job to a warning. GitHub reports a job killed by `timeout-minutes` as _cancelled_, so a test that timed out on a PR passed the gate. Only `failure` counted as failing, so `timed_out` and other results passed. Eight of the ten workflows had no gate at all.
- **Fix:**
  - `6dde77c`: any result other than success, skipped or cancelled fails the gate.
  - A cancellation passes only when two things hold: a newer commit replaced the run (checked with `git ls-remote` against `refs/pull/<n>/head` or the pushed ref), and the job's own `cancel-in-progress` evaluates to true for `GITHUB_REF` (`scripts/job-cancel-policy.mjs`). An unresolvable head fails closed.
  - `ed20d51` adds the gate to all eight remaining workflows.
- **Test:**
  - `js/tests/check-pipeline-status.js` (16 cases).
  - `js/tests/workflow-policy.js` "pipeline status gate": every workflow has an `if: always()` gate that needs every other job, and every job's `cancel-in-progress` is evaluable.

## D13 (FN): a Rust release with a missing crate counted as done

- **Root cause:** in `rust.yml`, with no fragments, a version whose tag and GitHub release existed fell through to "appears fully released" even when the crate was missing from crates.io. That happens when `cargo publish` failed after tagging. The run stayed green and the crate was never published. The lookup also ran `curl … || echo "000"`, so an unreachable registry read as "not published".
- **Fix:** `091a94c` adds `scripts/rust-release-state.mjs`. It releases (without a bump) whenever the tag, the GitHub release or the crate is missing. A 404 means not published. Any other lookup failure, after 3 attempts, fails the job with `Rust release state unknown`.
- **Test:** the "Rust release state" block of `js/tests/ci-scripts.js`.

## D14 (FN): the Rust tag could point at a commit that never reached main

- **Root cause:** `rust-version-and-commit.mjs` tagged before its push-retry loop. After `git pull --rebase`, the pushed commit differed from the tagged one.
- **Fix:** `4d78b23` tags after the push succeeds.
- **Test:** `js/tests/rust-version-and-commit.js`. A bare origin with a pre-push hook races a concurrent commit, and the test expects the tag to point at main.

## D15 (FP): the JS release failed whenever another merge landed during the run

- **Root cause:** `version-and-commit.mjs` pushed once with `git push origin main`. The Rust script already retried.
- **Fix:** `260efa4` adds `scripts/push-with-rebase-retry.mjs`: 3 attempts with `git pull --rebase origin main` between them.
- **Test:** the "pushWithRebaseRetry" block of `js/tests/ci-scripts.js`.

## D16 (FN): Model tests ran Groq models without a key

- **Root cause:** `model-tests.yml` only warned when `GROQ_API_KEY` was missing (Groq rejects every request without one) and never checked `KILO_API_KEY`.
- **Fix:** `ed60705` fails with the secret's name for Groq, and warns for Kilo, which allows anonymous free-model access.
