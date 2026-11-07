# Issue #203: requirements, research, and implementation plan

## Work checklist

- [x] Read #203, all six listed issues, all issue comments, and PR #204's conversation, inline reviews, and review verdicts.
- [x] Read contributing guidance and inspect release scripts, workflow callers, and tests.
- [x] Fetch main and inspect the most recent related merged PR (#200).
- [x] Merge main into the prepared branch, preserving history.
- [x] Audit previously resolved requirements and reproduce outstanding defects before implementation.
- [x] Research official documentation and the downstream implementation referenced by #202.
- [x] Apply fixes to every active caller and add a patch changeset.
- [x] Run local checks and all three runtime test suites; inspect saved logs.
- [x] Commit atomic changes, push only the prepared branch, and review the PR diff.
- [x] Inspect CI timestamps and SHAs, preserve failed logs, and resolve failures.

## Complete requirement map

The scope is the six issues listed in #203, including the three issues repeated
by #199. Nothing is deferred to another PR. No screenshots appear in these
issues or their comments; these changes have no visual UI surface.

| Issue and requirement                                                                                                | Possible solutions                                                                            | Applied plan and evidence                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #203 and #199: read every issue and comment, deliver one PR, and close every listed issue with individual keywords   | Separate fixes or one integrated branch                                                       | Use PR #204 only. Include `Fixes #203`, `Fixes #196`, `Fixes #197`, `Fixes #198`, `Fixes #199`, `Fixes #201`, and `Fixes #202` individually.                                                                                                                                                                        |
| #203/#199: explicitly identify already resolved or unreproducible issues                                             | Reimplement old fixes or incorporate current main                                             | #196, #197, #198, and their parent #199 were already implemented in merged PR #200. Merge and verify those changes; retain all closing references.                                                                                                                                                                  |
| #196: release without mandatory RELEASE_PR_TOKEN while retaining dedicated-token precedence                          | PAT, custom App, or built-in-token attestation                                                | The merged helper prefers the dedicated token and otherwise uses GITHUB_TOKEN. Both release paths pass the token and run after explicitly listed validation jobs.                                                                                                                                                   |
| #196: inspect generated metadata commit and keep executable/source tree identical to validated parent                | Broad file patterns or exact metadata allowlist                                               | Existing `release-metadata.mjs` checks the parent SHA and NUL-delimited diff-tree statuses. Only allowed manifests/locks/changelogs and deleted changesets pass; configurable exact paths support workspaces. Real Git fixtures reject source changes.                                                              |
| #196: give checks:write only to release jobs, create exact-SHA Pipeline Status with parent URL and invariant summary | Bypass branch protection or Checks API                                                        | Existing job-scoped permissions and check creation retain branch protection. Tests verify exact SHA, explanation, and ordering.                                                                                                                                                                                     |
| #196: wait for required checks before merge; fail closed on API, validation, check, or merge failure                 | Dispatch unrelated checks or watch PR-required checks                                         | Existing helper uses `gh pr checks --required --watch --fail-fast`; mocked error tests prevent merge after failure.                                                                                                                                                                                                 |
| #197: cover five-minute cache horizon and observed 309–310 second delays                                             | More attempts or a deadline loop                                                              | Existing 34 checks with capped backoff span 15.5 minutes; fake-clock tests cover the five-minute boundary, later appearance, one publish call, and bounded absence.                                                                                                                                                 |
| #197 comments: avoid CDN-cached packuments; distinguish unknown from missing                                         | Prefer-online npm view or fresh version-specific HTTP lookup                                  | Existing verifier and Docker wait request version-specific documents with cache-busting and no-cache headers. Only 404 means missing; registry failures remain errors/unknown.                                                                                                                                      |
| #197 comments: extend install smoke-test window and preserve release continuation after accepted publication         | Longer visibility window, warning-only verification, independent tags, or historical backfill | Existing smoke installs use prefer-online and a matching long window. This PR retains verified publication as the release gate, as decided in #200; warning-only tagging and backfill are alternative proposals, not mandatory issue requirements. A truly absent version must still fail, as explicitly requested. |
| #198: exclude staged deletions and rename source paths from Prettier; audit other diff consumers                     | Ignore unmatched patterns or filter Git statuses                                              | Existing `check-staged-formatting.mjs` uses ACMR and NUL-separated paths. The real Git deletion fixture passes. Other active name-only consumers classify changed paths rather than opening them in a formatter.                                                                                                    |
| #201: pin Bun consistently and reject latest in workflow tests                                                       | Exact version, package.json version file, or major line                                       | Set every active Bun setup to `1.x`, matching Node and Deno's major-line policy. Regression assertion rejects latest. Patch versions can still change; exact reproducibility would need an exact pin.                                                                                                               |
| #202: retry 429 and all 5xx with backoff, including cached lychee errors                                             | Accept 503 globally, rely on lychee retries, or bounded recheck                               | Parse numeric markers and rejected-status details as transient; recheck with 5/10/20/30-second capped delays under the shared 240-second budget. Persistent outages stay broken. Fix the prior loop's missing waits.                                                                                                |
| #202: authenticated GitHub blob/tree contents GET fallback and workflow token                                        | New HTTP library or built-in fetch plus REST API                                              | On transient page/transport failure, request api.github.com contents with the ref and path. Token is sent only to the API and redirects are rejected. Pass GITHUB_TOKEN in the recheck step.                                                                                                                        |
| #202: keep definitive 4xx other than 429 final; never hide real outages                                              | Ignore lists or require successful fresh evidence                                             | No new accepted statuses or ignore entries. A 404 gets one request; an API failure cannot mark a page healthy. The complete-report verdict still requires every failure to recover.                                                                                                                                 |
| Finalization: release trigger, automated checks, current base, clean branch, updated title/body, ready PR            | Manual release or Changesets                                                                  | Add a patch changeset, run all local gates, review final diff, inspect current-SHA CI, and mark #204 ready.                                                                                                                                                                                                         |

## Existing components and source research

The existing components are sufficient; an additional dependency would add
maintenance without improving the small recheck implementation.

- [setup-bun](https://github.com/oven-sh/setup-bun) accepts version ranges, so `1.x` implements the requested major-line policy.
- [Lychee](https://github.com/lycheeverse/lychee) already supplies retries and caching. Its cached transient results still require a fresh external probe rather than accepting 503 as healthy.
- [GitHub contents API](https://docs.github.com/en/rest/repos/contents) supports GET with a ref; Node's built-in fetch can perform the authenticated fallback.
- [Checks API](https://docs.github.com/en/rest/checks/runs) supports exact-commit check creation with checks write permission. [`gh pr checks`](https://cli.github.com/manual/gh_pr_checks) provides required-check waiting.
- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) supplies per-version metadata, avoiding the full package document used by the old verifier.
- [Downstream PR #2430](https://github.com/link-assistant/hive-mind/pull/2430) provides a related transient-link implementation. Its patch was inspected through authenticated gh.
- [Merged PR #200](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/200) provides the completed release fixes and detailed analysis in `docs/ISSUE-199-RELEASE-ANALYSIS.md`.

## CI investigation

The initial Security run 37292309846 was created at 2026-10-05 09:47:02 UTC
for SHA 2f20b1022ba45ccbbcb2f24b8345aae2fbf59292, before these fixes.
Its log is preserved locally in `ci-logs/initial-37292309846.log`.
The example lockfile audit reports high-severity brace-expansion findings at
lines 2085–2094 and Electron findings at lines 2103–2105. A fresh local audit
also found vulnerable root development dependencies. Refresh the affected
locks and upgrade Changesets, jscpd, and lint-staged; recheck their integration
through all tests and the contributing checks. This is needed to satisfy the
requested passing-CI finalization, and no audit threshold is weakened.

## Verification results

`npm run check` passed. Node and Bun each passed 487 tests; Deno passed
388 tests and eight steps. Focused link tests passed on all three runtimes after
the request helper refactor. The isolated Changesets 3 experiment generated a
patch version and changelog successfully. Root and example audits both report
zero vulnerabilities.

All five remote workflows passed on implementation SHA
`78380c9ed37f6277137797928530f97ac9f8b096`, including the nine-platform/runtime
matrix in [Checks and release run 37293641393](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37293641393).
Security, Workflows, Broken Link Checker, and Example app also passed on that SHA.
During testing, main released 0.11.31; that metadata commit was merged into this
branch before finalization. PR #204 is marked ready only after final checks.

The intermediate dependency-only run 37293466556 failed because that atomic
commit had no new changeset (log line 2772), and jscpd's refreshed detector
reported the existing code above the duplication threshold (line 1812).
The complete implementation commit includes the patch changeset and passes
the same unchanged duplication threshold. Both failed runs' logs are preserved
locally under `ci-logs/`; no security or quality threshold was reduced.
