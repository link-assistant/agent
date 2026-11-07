# Issue 287 requirement and verification plan

All work belongs to PR #288. Read #287, native sub-issues #283–#286,
all issue comments, and all three PR comment/review endpoints (empty initially).
No UI behavior changes are requested. No Rust behavior or builds are involved.

| Requirement                                               | Options and selected solution                                                                                            | Verification                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 283: internal commit_refs_rules and explicit HTTP 429/5xx | Retry unchanged push with bounded backoff; do not infer a server root cause or rebase on transient failures              | Injected success, exhaustion, final stderr, permanent precedence                     |
| 283: permanent rules/auth                                 | Fail immediately for releases; preserve explicitly requested changeset PRs and preview behavior                          | Rule/auth fixtures and existing PR fallback tests                                    |
| 283: default-off diagnostics                              | Log attempt, exit and classification with CI_SCRIPTS_DEBUG=1                                                             | Captured logger assertions; no credentials                                           |
| 283: metadata-only releases, validated parent             | Stage only release paths, attest each push, reject source race rather than rebase                                        | Real temporary Git attestation and publication tests                                 |
| 283 comment: publication race                             | Fetch and verify ancestry without changing publishing checkout                                                           | Newer source, local/remote version children, dependency drift tests                  |
| 283 comment: rerun recovery                               | Adopt only attested version child; preserve same-version self-healing                                                    | Real Git tests and version workflow tests                                            |
| 283 comment: manual syntax/line gates                     | Add !cancelled() and explicit dispatch branch to both conditions                                                         | Workflow condition tests, including skipped detect-changes                           |
| 284: minimatch/glob advisories in all three locks         | Scoped modern-major overrides; retain legacy callable APIs                                                               | All-lock inventory/audits, archive probe, real ASAR probe, hosted artifact roundtrip |
| 284: local action compatibility                           | Existing baseline already lists affected files; enforce complete exact inventory rather than switching to unsupported $/ | All workflow/action consumers compared with narrow zizmor exception                  |
| 284: scorecard                                            | Display scores with threshold 0; retain vulnerability threshold and complete audit reporting                             | Workflow policy assertions                                                           |
| 284 comment: audit execution                              | Accept normal exits 0/1 only; reject signal/transport failure and exit 1 without evidence                                | Injected process failures                                                            |
| 284 comment: audit evidence                               | Validate map, advisory records, dangling references and reference-only cycles                                            | Malformed report regressions                                                         |
| 284 comment: Windows fixture                              | Set core.autocrlf=false immediately after temporary git init                                                             | Existing assertions retained; Windows CI                                             |
| 285: pinned CLI in writer                                 | Reuse official reviewed archive installer with fixed SHA256                                                              | Missing CLI and checksum rejection fixtures; real CLI smoke                          |
| 285: PR container coverage                                | Read-only same-image job, dummy credential fill; writer depends on smoke                                                 | Actual hosted Playwright container check                                             |
| 285: wiring and filters                                   | Cover smoke in terminal gate and all transitive writer helpers in both event filters                                     | Workflow and status coverage tests                                                   |
| 285: diagnostics                                          | Tool paths only with CI_SCRIPTS_DEBUG=1                                                                                  | Checker regression                                                                   |
| 286: adjacent lychee errors                               | Parse one line at a time, only Errors section                                                                            | Adjacent 404/ERROR, descriptions, section-boundary fixtures                          |
| 286: CodeQL notification arrays                           | Fail on warning/error/default warning/malformed; allow note/none; retain finding gate                                    | Both arrays, empty results, descriptor/location/message output                       |
| 287: one PR, complete scope and closing references        | One batch push coordinator; no merge/release/deploy                                                                      | Updated PR closes each of #283–#287 separately                                       |

Execution: draft all changes and regression cases, run focused native JavaScript
checks, review whole diff, commit and validate exact revision, push one batch.
Collect all same-SHA CI failures and logs before making another batch. Keep
memory-heavy installs/builds sequential; leave full platform/build matrix to CI.

Research and component decisions are recorded in research.md. Final verification
will record commands, results, exact revision and CI links here or in the PR.
