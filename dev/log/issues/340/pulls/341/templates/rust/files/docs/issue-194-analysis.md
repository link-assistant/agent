# Requirements and investigation for issues 192–194

The scope is the body of [issue 194](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/194), both child issues and the cleanup comment on issue 192. Baseline: `cece347b3cd3a0b715583d7294e1fd93ad2d4c56`. Neither defect is already resolved.

## Complete requirement matrix and plans

| Requirement | Alternatives and selected solution | Verification |
| --- | --- | --- |
| 194.1: Read and implement both issues, including comments. | Inspect issues, paginated comments, PR discussions and all producers; implement both together. | This matrix includes the additional cleanup requirement. |
| 194.2: One PR; no deferred child issue. | Update existing PR 195 on `issue-194-3c7f57a74cd2`. | Review the complete PR diff and checks. |
| 194.3–4: Close the parent and every child with separate full keywords. | Put `Fixes #194`, `Fixes #192`, and `Fixes #193` on separate lines in the final description. | Read the final PR body. |
| 194.5: State explicitly if any issue is already fixed or irreproducible, while retaining references. | Both are reproducible; report before/after evidence. | Saved negative-test logs and regression commands below. |
| 192.1: Configured output open failures must exit unsuccessfully. | A downstream key-presence workaround could guard individual consumers; a shared Rust writer returning `io::Result<()>` fixes all producers. Select the shared writer and propagate errors through `main`. | Temporary-directory output fixture; check nonzero status and path/context. |
| 192.2: Output write failures must also be fatal. | Checking only path existence misses full disks and device errors. Propagate the write result as well as the open result. | Linux `/dev/full` CLI test; portable failing-writer unit test. |
| 192.3: Unset output supports local runs. | Distinguish absence using `var_os`; return success only when unset or after a successful append. An empty configured path remains an error. | Local CLI fixtures; shared writer tests. |
| 192.4: Apply to every producer; do not redirect invalid paths to `/dev/null`. | Replace all nine Rust implementations with the shared writer, retaining output names and console messages. Audit shell and Node producers too. | Shared tests, CLI regressions, producer inventory and denied-warning compilation. |
| 192.5: Regression coverage for invalid, valid and unset output. | Isolated real CLI fixtures avoid registry publication and use the template's supported skip paths. Wire them into the existing script-test job. | `experiments/issue-192-release-io-regressions.py`. |
| 192 comment.1: Changelog cleanup must reject directory-read, entry and deletion errors. | Explicit fatal errors or `Result` propagation both work. Use fallible shared fragment listing and fallible deletion. | Directory replacing a collected `.md` file; a file replacing the fragment directory. |
| 192 comment.2: Only print removal/completion after success, with the failing path and OS error on failure. | Propagate contextual errors before success messages. | Cleanup unit test and CLI fixture assertions. |
| 192 comment.3: Reject collection read errors instead of pretending the collection is empty. | Share fragment listing across the standalone collector, version-and-commit collector/count/verification, and bump-type reader. Read every selected fragment before mutation. | Invalid directory and unreadable fragment fixtures; preserve readable fragments and existing changelog on failure. |
| 193.1: Reproduction includes Dependabot and matches action input scope. | `.github` includes Dependabot but misses actions outside that directory. `.` exactly matches the action default. Set action `inputs: .` explicitly and use `.` in both regular and pedantic invocations. | Policy test and an actual zizmor 1.30.1 Dependabot fixture. |
| 193.2: Retain triggers covering `.github/dependabot.yml`. | Existing `.github/**` filters already cover it; retain them. | Workflow review and existing policy tests. |
| 193.3: Any shipped Dependabot configuration needs seven-day cooldowns for every ecosystem. | No Dependabot config is shipped; adding one would change dependency management beyond the request. Document the seven-day setting for future configs and verify it in a temporary fixture. | Audit fixture with and without `cooldown: {default-days: 7}`. |
| Release preparation | CONTRIBUTING forbids editing versions manually. Add a patch changelog fragment, the pipeline's documented release trigger. | Fragment reader/check and existing version-modification gate. |

## Root causes and whole-codebase inventory

Nine Rust scripts implement Actions output writes independently:
`get-version`, `check-release-needed`, `version-and-commit`, `wait-for-crate`,
`smoke-test-published-crate`, `get-bump-type`, `detect-code-changes`,
`publish-crate`, and `check-crate-size`. Five warn on errors; four discard
open/write results. Missing outputs can turn downstream conditions into skips.

The standalone collector discards directory, entry, fragment-read and deletion
errors. The collector inside `version-and-commit` already rejects deletion
failures, but its listing, reads, count and post-write verification discard
errors. The bump reader also suppresses reads. Those paths need the same
fallible listing rather than independent partial fixes.

Shell output appends run under failure-sensitive shell settings, and the
desktop resolver uses stdout only for local runs. `check-web-archive.mjs`
propagates append failures. `recheck-broken-links.mjs` deliberately treats
crashes as no recovery: its optional output can only rescue an already failed
link check, so a missing output preserves that failure. It is not a required
release output and its conservative recovery policy is retained.

The zizmor action defaults to repository input `.`; the documented regular
command only reads workflows, and the pedantic command reads workflows and
`.github/actions`. This mismatch reproduces a false clean local result when
Dependabot is the only source of findings.

## Primary sources and existing components

- [GitHub environment files and step outputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-output-parameter) document the output-file protocol. [GitHub's variable reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) identifies `GITHUB_OUTPUT` as the current step's output file.
- [Rust OpenOptions](https://doc.rust-lang.org/std/fs/struct.OpenOptions.html), [Write](https://doc.rust-lang.org/std/io/trait.Write.html), and [read_dir](https://doc.rust-lang.org/std/fs/fn.read_dir.html) provide all needed mechanisms. Opening and writing are independently fallible; directory iteration can fail after opening. A small shared module avoids adding a dependency to nine standalone scripts.
- [GitHub's actions/toolkit](https://github.com/actions/toolkit/blob/main/packages/core/src/file-command.ts) supplies output helpers for JavaScript actions, but would require a runtime/language migration here. Rust's standard library is sufficient for existing single-line keys and values.
- [zizmor input collection](https://docs.zizmor.sh/usage/#input-collection) supports repository directories and Dependabot configs. [Pinned action metadata](https://github.com/zizmorcore/zizmor-action/blob/v0.6.4/action.yml) confirms `inputs: .`, regular persona, and default collection. Keep the existing zizmor 1.30.1 pin to reproduce CI exactly.
- [zizmor's cooldown audit](https://docs.zizmor.sh/audits/#dependabot-cooldown) and [Dependabot options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown) support the seven-day policy. The existing analyzer already solves the detection problem; no replacement analyzer is needed.
- [lino-i18n PR 24](https://github.com/link-foundation/lino-i18n/pull/24) supplies a related shared-writer and cleanup precedent. [web-capture PR 178](https://github.com/link-assistant/web-capture/pull/178) records the real Dependabot discrepancy. [Template PR 191](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/pull/191) supplies the existing isolated CLI regression and patch-fragment conventions.

## Reproduction and validation

Run `python3 experiments/issue-192-release-io-regressions.py -v` and
`rust-script --test scripts/collect-changelog.rs` for release I/O regressions.
Run `ZIZMOR=/path/to/zizmor python3 experiments/issue-193-zizmor-inputs.py -v`
with zizmor 1.30.1 for the actual collection discrepancy. The analyzer fixture
is temporary and offline. The Rust workflow policy regression runs in
`cargo test`; release CLI and shared-module tests run in `scripts/test-scripts.sh`.

The probes use finite fixtures and process deadlines; compilation happens
before CLI deadlines. Builds use two Cargo workers locally. Full logs are
saved outside the checkout under `/tmp/issue-194-logs`; fresh failed CI logs,
if any, are saved under `ci-logs/` and investigated by SHA and creation time.

Collection can still partially mutate files if deletion fails after a successful
changelog write. The fix reports that failure and does not claim completion;
restore the previous state before retrying, as the issue comment requests.
Transactional release writes are a separate design change.

The baseline release CLI experiment produced 17 failing cases; the corrected
implementation passes all seven test methods and their subcases. The full
Rust run also exposed an existing timing assertion that required exactly two
seconds even though the budget wrapper correctly measured three under load.
It passed in isolation. The assertion now checks a measured overrun of at least
two seconds against the one-second budget, retaining the timeout behavior.
