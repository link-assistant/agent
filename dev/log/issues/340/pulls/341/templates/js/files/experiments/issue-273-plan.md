# Issue 273 implementation and verification plan

Coordinator: the root agent owns all commits and pushes to `issue-273-c1a8c727a5d6`.
No merge, release, deployment, cache deletion, or default-branch writes are authorized.

## Checklist

- [x] Read AGENTS.md, CONTRIBUTING.md, javascript-first.md, parent issue, all nine child issues and comments, and all three PR feedback types (empty initially).
- [x] Verify prepared branch and clean initial tree; collect initial CI timestamps/SHA.
- [x] Research official component contracts and recent related implementations/PRs.
- [x] Reproduce each defect with offline, bounded regression tests before fixing it.
- [x] Implement every requirement in the matrix below throughout maintained code/workflows.
- [x] Run focused checks, then the full Node, Bun, and Deno suites sequentially within the 2.92 GiB budget; retain large logs.
- [x] Run lint, formatting, duplication, syntax, shell/workflow policy, file limits, documentation, changeset/version guards, and an offline release rehearsal.
- [x] Fetch default branch, merge if needed, review the entire candidate diff and commit atomic changes (first batch `edc0abed`).
- [x] Validate the exact candidate revision and push once for the first batch.
- [x] Collect every first-revision CI failure and preserve all six run logs in ci-logs; fix together before the next push.
- [ ] Validate and push the follow-up candidate once; collect and resolve all final-revision CI results.
- [ ] Update PR title/body with reproduction, evidence, limitations, and one positive closing reference per issue 264–273; review gh pr diff and mark PR 274 ready after verification.

## Requirements and solution choices

| Issue | Complete requirements                                                                                                                                                                                                                                                                                            | Candidate solution and verification plan                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 264   | Retry transient artifact transport errors for diagnostic and release-critical uploads; bound attempts; retain missing/empty evidence and permanent auth/4xx/quota failures; reconcile finalized artifacts after a lost response; never globally ignore failures; cover all artifact paths.                       | A local JS action using the official artifact/glob/core components, with injected transport tests for recovery, exhaustion, permanent refusal, empty evidence and duplicate-name reconciliation. Package Pages evidence in the official tar layout before using the same transport. Examine downloads too. |
| 265   | Eliminate 300-file diff-limit fallback warnings without skipping languages/default queries; environment must cover init and analyze; hosted 300+ file regression.                                                                                                                                                | Explicit job-wide full analysis through CODEQL_ACTION_DIFF_INFORMED_QUERIES=false, workflow contract tests, and a hosted 300-file candidate/merge fixture with complete analysis.                                                                                                                          |
| 266   | Aggregate Security must fail on CodeQL findings, missing/malformed reports and failed invocations across every file/run/severity; retain normal Code Scanning upload/all queries and preserve SARIF even on failure.                                                                                             | Dependency-free strict local SARIF gate after analyze with explicit output directory; CLI fixtures for all states and workflow ordering/artifact checks. No exceptions needed for this template.                                                                                                           |
| 267   | Missing, unreadable, empty or malformed reports after failed lychee must fail and never emit all_archived=true; final workflow failure independent of archive suggestions; preserve required report.                                                                                                             | Strict report validation and explicit checker status; subprocess regressions without network; retain independent final exit gate and required artifact policy.                                                                                                                                             |
| 268   | Pin actual hook to root lint-staged config; nested archived tasks must never run; maintained source checks and root archive exclusions remain active; document monorepo boundary choice.                                                                                                                         | Explicit --config package.json plus integration fixture invoking the installed CLI with actual hook arguments, nested failure sentinel and maintained-path recorder. Verify immutable archive hashes.                                                                                                      |
| 269   | Bun discovery limited to maintained tests; exclude dev/log and dist sentinel tests; retain per-test timeout; distinguish archives from maintained sources in location policies.                                                                                                                                  | Real bunfig [test] root='./tests'; isolated executable fixture copying the real config with owned and throwing archive/generated tests; inspect every Bun entry point and location policy.                                                                                                                 |
| 270   | Both version paths preserve every non-version lock field and peers in root/nested layouts; validate npm v2/v3 names/root; no dependency resolution; locally installed Changesets via npx --no-install; strict release-tree guard and offline PR rehearsal.                                                       | Shared metadata-only lock synchronizer with graph invariant; both script integration tests against preserved peer graphs, invalid lock tests and offline rehearsal in PR lint validation.                                                                                                                  |
| 271   | Required release formatting fails on missing/401/403/429/5xx/network/malformed release state; commit lookups fail before PATCH on unknown/refused/malformed pages; only valid empty arrays mean no PR; fetch every page and relevant PR, deduplicate across commits; retain notes and idempotent retry behavior. | Strict release response validation and paginated/slurped PR metadata validation; virtual-command offline CLI tests for all refusals, no writes, page 31, empty PR lists, deduplication and repeat success.                                                                                                 |
| 272   | Release heading boundaries and target selection must ignore backtick/tilde fenced code with matching delimiter/length, plus indented code; preserve original body/indentation and CRLF; missing entries fail; commit-shaped example bullets and headings never become metadata; multiple subsections remain.     | Shared Markdown line scanner for release boundaries, change headings, badge detection and commit hashes, with focused helper and CLI regressions preserving prose and examples. Assess CommonMark parser versus minimal scanner.                                                                           |

Native JavaScript is the implementation language. No Rust translation or adapter is introduced; the existing strict JavaScript-first readiness gate and all acceptance assertions remain required.

## Local evidence before the first hosted batch

- Node: 1,016 passed; Bun: 1,016 passed; Deno: 1,015 passed, one existing skip: Deno resolves imports from an npm-style bin symlink directory.
- Offline real-changeset rehearsal preserved all non-version manifest/lock fields.
- ESLint, Prettier, duplication (8.51%, below 10%), secrets, actionlint 1.7.12, ShellCheck 0.11.0, both zizmor 1.30.1 passes, syntax, required docs, workflow policy and status-gate coverage passed.
- Full requirement inventory, research and component choices: `docs/issue-273-analysis.md`.
- Regression failures and complete command logs retained in ignored `ci-logs/*.log`; downloaded research is in `ci-logs/issue-273-research/`.
- Latest issue and all three PR comment types remain empty. `origin/main` is already an ancestor of this branch.
- Hosted 300+ file verification completed on the first candidate; final-revision CI remains pending.

## First hosted batch and follow-up

Candidate `edc0abed770b2b29a343e6d702141419226c4ed0` was pushed once after
exact-revision checks. PR 274 changed 355 files, including 301 owned temporary
Markdown fixtures. GitHub's PR diff endpoint rejected that candidate with its
300-file limit, confirming the regression boundary was exercised.

The JavaScript CodeQL analysis completed and uploaded SARIF. The new gate rejected
one real finding, `js/incomplete-url-substring-sanitization`, in the executable
historical release formatter at `docs/case-studies/issue-3/original-format-release-notes.mjs:87`.
Job 123748804999 log lines 2692–2694 show the finding and failing exit; the next
artifact step successfully retained the report. Replaying that downloaded report
through the real CLI also exited 1. The log shows full-analysis mode at init and
analyze, with no 300-file fallback warning. The Actions analysis also completed
cleanly: job 123748805525 log line 1699 reports one clean SARIF report; it likewise
has no diff-limit fallback warning. All six same-revision workflows finished and
their logs were collected before the follow-up batch. Workflows, links, example-app
(including all desktop platforms), and the JavaScript-first/Rust workflow passed.
Security failed only on the real JavaScript finding; Checks and release failed
only on the Windows tar-listing test across Node, Bun and Deno. The owned 301-file
fixture was removed after this evidence was collected; its generator remains.

Follow-up regressions failed before their fixes and pass afterward: preserving
packaged file symlinks, requiring the link report even when optional diagnostics
exist, and rejecting deceptive hostname placements in both executable formatter
copies. The historical formatter now shares the strict badge predicate; queries
and findings policy remain unchanged. The link artifact retains the whole lychee
directory while explicitly requiring nonempty `out.md`. The SDK lock is included
in reviewed-deprecation coverage as well as the audit matrix.

Windows Node, Bun and Deno jobs exposed the same test
harness error: GNU tar interpreted the archive's `C:` drive as a remote hostname
when listing it (full run 40959660488 log lines 13101–13120, 13513–13528,
and 7775–7792 respectively). Packaging already
uses `--force-local`; the test's listing now does too, preserving its assertions.

Additional malformed-report regressions demonstrated that a parseable recovered
URL could bypass report validation in either fallback. Both CLIs now share a
strict summary check. Official lychee v0.24.2 source confirms the current Summary
heading and separate timeout section, both covered alongside older captured
reports. Existing successful-recovery, refusal and Wayback retry assertions remain.
