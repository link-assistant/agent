# Issue 215: pipeline repair and verification

This inventory covers the aggregate issue, all 18 required sub-issues and PR 216
feedback. The October 13 policy comment on issue 205 supersedes token retirement:
keep both token secrets, try OIDC first, and retain token fallback.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| 196: real opt-in JS-first gate, exact revision, complete inventory, deterministic translation, all Rust paths gated; one coordinator push and uncancellable writers | Reusable workflow, `run-javascript-first.sh`, independent executable `examples/javascript-first/` caller, root agent and contributor policy | Native Node suites reject missing/partial/carried entries, failed/skipped native commands, stale hashes, target drift and wrong SHA; caller contract covers test/build/package/publish dry run/container; downstream Rust fixtures run in CI |
| 198: exempt Dependabot by PR author, never branch naming | `check-changelog-fragment.rs` uses exact `PR_AUTHOR`; release workflow passes login | Inline unit tests and a real Git/CLI regression cover bot, human and empty authors on a spoofed branch |
| 199: retain writer queue and narrow actionlint exception | All release, Docker, Pages and desktop writers use repository `main-writer` group, cancellation false and `queue: max` | Workflow concurrency assertions; actionlint 1.7.12 with only the queue schema diagnostic ignored |
| 200: compare PR head, resolve fork head in base repository | Every terminal observer passes head SHA and `refs/pull/N/head`; script honors `HEAD_REF` | Isolated Git test with no branch in base repository; current, superseded and unknown-head cancellation cases |
| 201: release PR runs CI without a manual approval gap | Dedicated `RELEASE_PR_TOKEN` and required-secret preflight | Workflow regression checks require that token and preflight; configuration documented in README |
| 202: fixed toolchain input handling and consistent modern actions | dtolnay input-fix commit, checkout 7/cache 6/upload 7/download 8; immutable checkout/node pins in callable gate | All-workflow version assertions, actionlint and zizmor; upstream master ancestry checked |
| 203: actual multiline fresh-merge checks and correct merge parent/identity | One fail-fast Bash command per nonempty line, aggregate status, merge `FETCH_HEAD`, bot numeric-email prefix | Real divergent Git histories, quoted filenames, missing remote tracking ref, failing command followed by another, original branch restoration |
| 204: shell-only changes activate code checks | Detector includes `.sh`, `.py`, `.json`, composite-action files, preserving documented folder exclusions | Inline path classification tests and existing per-event matrix |
| 205: trusted publishing with secret fallback and matching credential probe | Pinned auth action in both publishing jobs; id-token permission; OIDC availability preflight then proof of selected credential before build; secrets retained | Workflow assertions and mocked credential tests; operational scope below |
| 206: release needs all checks, dispatch default, lychee persistence, pinned Windows | Expanded fail-closed dependencies; patch default; cache/report artifacts; windows-2025 | Workflow regressions check each prerequisite and both failure/cancellation guards; actionlint |
| 207: distinguish disabled graph from transient failure | `check-dependency-graph.sh` probes compare API with bounded retries; PR warns/skips; main requires availability | Fake-gh enabled/403/rate-limit/502/network/404 cases, eventual recovery and main failure |
| 208: narrow deploy-pages warning suppression | `NODE_OPTIONS: --disable-warning=DEP0040` only on deployment step | Workflow regression assertion |
| 209: authenticated pedantic audit | Built-in read-only GitHub token passed at step scope | Workflow assertion and local authenticated zizmor run |
| 210: Git default branch configured before checkout | Workflow environment on every workflow | All-workflow assertion |
| 211: split oversized sources, delete exceptional caps | Version writer helpers/tests and release gate tests extracted | Existing tests run through both Cargo and rust-script; file-size check uses uniform 900/1000 source thresholds |
| 212: standalone shell lint, triggers, local hook, existing findings | Pinned shellcheck-py job/hook, shell path triggers, fixes and targeted literal/trap annotations | ShellCheck on all tracked and newly added shell files; aggregate observer includes lint job |
| 213: avoid early budget expiry due to integer clock rounding | Strict elapsed comparison for deadline and termination grace | Regression starts late within a wall-clock second and completes inside a 2-second budget; timeout/process-tree tests retained |
| 214: evaluate only supported ref comparisons, fail closed otherwise | Exact single-quoted `github.ref` equality/inequality with case-insensitive comparison and required ref | Actual release jobs on PR/main; unsupported-expression, unknown-ref and cancellation tests |
| PR feedback: recover from build OOM without dropping acceptance criteria | Sequential compiler jobs with debug information disabled locally; heavy runner validation in CI | Full local suites and exact-head CI, preserving all production assertions |

## Reproduction

`python3 experiments/issue-215-regressions.py -v` initially failed the workflow,
fresh-merge, fork/cancellation, elapsed-budget and graph-probe cases against the
prepared base. The Node gate's mutation cases then prove each prerequisite fails
closed. `scripts/test-scripts.sh` includes both suites alongside all existing
inline Rust tests and the older real-Git and mocked-publishing regressions.

## First candidate CI findings

The first pushed candidate `9c84388` exposed two inherited test assumptions in
[CI run 40408441155](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/actions/runs/40408441155),
saved as `ci-logs/ci-cd-40408441155.log`, lines 5007 and 5021 (also on Linux, macOS and
coverage). Both tests inherited CI's PR `GITHUB_REF`, while their expected result
described main or an unsupported expression. Re-running those tests locally with
the CI ref reproduced both failures. Their fixtures now set the intended ref and
workflow explicitly and use an actually unsupported expression for the unknown
case; production cancellation rules and all assertions remain enforced.

The CodeQL Actions analysis also found two cache-poisoning paths through the
example's optional arbitrary-revision manual dispatch. A new regression first
failed on that trigger. The example now runs on PR/push revisions; release callers
still pass an immutable candidate through the reusable gate's required input.
No security query or finding was disabled to make the checks pass.

## Trusted-publishing rollout scope

The checked-in workflow and the historical `rust-template-release-after.yml` snapshot
support OIDC-first authentication with token fallback. Historical `before`
snapshots remain evidence of the original behavior. Configure each real crate's
trusted publisher for this repository, the top-level `release.yml` workflow and
its actual environment; see the README bootstrap instructions.

Registering trust for existing derived repositories and synchronizing copies in
the external JavaScript template require changes outside this single pull
request. The original issue also requests a post-merge migration; this PR remains
unmerged, so that operation cannot yet be verified. Token deletion is expressly
forbidden by the later policy comment. These external/post-merge acceptance
criteria remain unfinished; passing this PR's checks does not prove deployment
or OIDC authentication for a real renamed crate.

The external JavaScript template currently contains these requested copies:
`docs/case-studies/issue-40/rust-template/release.yml`,
`docs/case-studies/issue-41/data/rust-template-release.yml` and
`docs/case-studies/issue-58/data/rust-template-release.yml`. They are in
`link-foundation/js-ai-driven-development-pipeline-template`, outside this PR's
repository. `package-registry-manager#62` is still open and documents that older
migrations remove fallback and delete secrets, so running that migration without
first verifying its policy support would contradict the accepted requirement.
