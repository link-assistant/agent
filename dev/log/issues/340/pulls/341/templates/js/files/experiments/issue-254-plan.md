# Issue 254 delivery checklist

Objective: implement and verify all 23 required issues in PR 255, preserving
existing features and history. Work only on `issue-254-a1fc75afdb37`.

1. [x] Read the parent issue, all 23 sub-issues and their comments, and all PR
       conversation comments, inline comments and reviews.
2. [x] Compare CI timestamps and SHAs; preserve failing logs in `ci-logs/`.
3. [x] Inspect repository guidance and recent related downstream fixes.
4. [x] Add regressions and capture failures before fixes. Local logs include
       `regressions-before.log`, `pipeline-before.log`,
       `javascript-first-before.log` and `dependency-graph-before.log`.
5. [x] Implement every requirement below; run focused regression suites.
6. [x] Finish full Node, Bun and Deno suites sequentially within container memory.
7. [ ] Commit atomic changes after local checks, merge latest main and review the
       full PR diff for regressions and scope completeness.
8. [ ] Update PR title/body with reproduction, test evidence and all 24 closing
       references; push one validated batch and inspect CI at the new SHA.
9. [ ] Preserve and diagnose every failed run; fix and revalidate as needed.
10. [ ] Verify clean working tree, green checks and complete evidence; mark ready.

This checklist is a snapshot before the first validated push. The PR description
and latest-revision CI checks record final commit, push and readiness results.

## Requirement inventory and verification

| Issue    | Implementation                                                                                                                                                              | Verification                                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 230      | Callable JavaScript/parity/regeneration gate, immutable tested SHA, real mixed-language caller and pinned translator, contributor/agent policy                              | `javascript-first-gate.test.js` executes actual gate steps in temporary Git repositories; complete inventory permits six Rust paths, failures/skips/missing/partial/carried entries/drift/changed revisions block them; CI executes native Rust observations |
| 232      | Exact Dependabot PR author exemption before diff lookup                                                                                                                     | `pr-guards.test.js`: actual bot passes, spoofed branch fails                                                                                                                                                                                                 |
| 233      | All seven main writers use one group, `queue: max`, cancellation disabled; narrowly ignored actionlint diagnostic                                                           | `pipeline-requirements.test.js`, `workflow-reliability.test.js`, actual actionlint                                                                                                                                                                           |
| 234      | checkout/setup-node v7 throughout, setup-java v6                                                                                                                            | `action-versions.test.js` inventories workflows/composites and verifies immutable pins                                                                                                                                                                       |
| 235      | Every non-exempt changed file counts as code                                                                                                                                | `detect-code-changes.test.js` covers shell, types, Dockerfile, TOML and documentation exclusions                                                                                                                                                             |
| 236, 242 | Preserve Markdown lists, indentation, paragraphs, separators, literal escapes and all entries; unique PR lookup for every commit                                            | `release-notes-description.test.js` and real formatter integration with fixture API/command stubs in `release-notes-integration.test.js`                                                                                                                     |
| 237, 245 | Bash and safe checkout in preview container; propagate git failure; optional dedicated token with built-in fallback; report actual outcomes and existing artifact directory | `container-jobs.test.js` executes drift, token fallback/push/staging outcomes and six summaries; `workflow-reliability.test.js` verifies artifact wiring                                                                                                     |
| 238, 241 | Supported ESLint 10, declared @eslint/js, preserve error causes, fail reported warnings and check all warnings on main                                                      | `lint-changed-lines.test.js`, manifest import test in `pipeline-requirements.test.js`; `LINT_ALL_WARNINGS=1 npm run check`                                                                                                                                   |
| 239      | OIDC 404 diagnostics distinguish unpublished package bootstrap from missing trusted publisher                                                                               | `release-preflight.test.js` executes HTTP fixtures for package lookup 200/404/unknown                                                                                                                                                                        |
| 240      | Bounded process-tree termination, closed stdin, captured output/elapsed time, primary-error-preserving cleanup and optional tracing                                         | `bounded-run.test.js` exercises actual descendants, escaped pipes, cleanup and Windows taskkill arguments; Changesets offline fixture under all runtimes/OSes                                                                                                |
| 243, 246 | Exact deprecation inventory, global-agent override, refreshed npm/Deno locks and patched audit findings                                                                     | `deprecated-packages.test.js`, root/example `npm audit`, proxy bootstrap, web build and actual Electron directory packaging                                                                                                                                  |
| 244      | Pages source probe warns on PRs, fails with setting/action on main, grants explicit read permission                                                                         | `check-pages.test.js` executes enabled/disabled/legacy/error fixtures; workflow ordering tests                                                                                                                                                               |
| 247      | Static names for conditionally skipped test/Docker matrices                                                                                                                 | `pipeline-requirements.test.js` checks every conditional matrix job                                                                                                                                                                                          |
| 248      | Default patch dispatch, persisted lychee cache, failure report artifact, strict Prettier step                                                                               | `pipeline-requirements.test.js` and link/workflow tests                                                                                                                                                                                                      |
| 249      | Dependency-graph preflight classifies disabled separately from transient/unknown failures and retries boundedly                                                             | `dependency-graph.test.js`: enabled, disabled, 401, 404, rate-limited 403, 503, network failures and recovery; required-main failure and PR warning                                                                                                          |
| 250      | Scoped DEP0040 suppression on deploy-pages                                                                                                                                  | `pipeline-requirements.test.js` verifies other Node warnings remain visible                                                                                                                                                                                  |
| 251      | Pinned standalone ShellCheck, Husky shell declaration and staged/CI path coverage; fix findings                                                                             | `pipeline-requirements.test.js`, actual ShellCheck of tracked scripts/hooks                                                                                                                                                                                  |
| 252      | Strictly greater deadline comparison for budget and kill grace                                                                                                              | `run-with-budget-warning.test.js` aligns a command to a wall-second boundary to reproduce early termination                                                                                                                                                  |
| 253      | Needs parser tolerates comments/blank lines; status gates use base-repository pull-request head refs                                                                        | `status-gate-coverage.test.js`, `pipeline-status.test.js` creates colliding base/fork branches and actual pull refs                                                                                                                                          |

## CI investigation and resource protocol

Baseline Security run 39917108648, created 2026-10-23T07:20:42Z, tests
`5bb14befdd863786202e4a2efabb886def010691`. Both npm audits fail; the terminal
security gate correctly fails. Preserved log: `ci-logs/security-39917108648.log`.
Root launch-editor findings appear at lines 2068–2082; example launch-editor/Vite
findings appear at lines 4000–4016. Refreshed locks now audit with zero findings.

After each push, list recent runs with timestamps and head SHA, download every
non-passing run to `ci-logs/<workflow>-<id>.log`, read actual errors and resolve
all failures from that revision before the next batch. Never infer success from
an earlier commit's green checks. Finalize only after every latest-SHA check passes.

The earlier attempt exhausted memory before implementing changes. Keep installs,
builds and runtime suites sequential, Node heaps at 384 MiB, Node test concurrency
at one and Deno worker count at one locally. Use CI for the cross-OS matrix and
Rust downstream execution. No user caches or dependency directories were deleted.

The first batch at `1885f26` passed the native JavaScript prerequisite, all six
Rust paths, both dependency audits, workflow checks and desktop packaging. Link
run 40085623968 identified a moved pipx installation URL at log lines 303 and
321–323. CodeQL check 120847976552 identified three cache-poisoning paths: the
callable gate executes a caller-selected revision while setup-node automatically
enables package-manager caching. Disable that cache explicitly; the gate
regression fails before the fix (`cache-isolation-before.log`). Preserve both run
logs and all remaining same-revision failures before the next validated push.

At `2795357`, the link check passes, but final CodeQL analysis 2018680050 still
reports the three paths. Its SARIF confirms that the cache token itself remains
available regardless of setup-node caching. Remove the new example's optional
manual-dispatch trigger: its real caller needs only PR checks (isolated cache
scope) and trusted main pushes. Keep immutable candidate support in the reusable
gate and document the trust requirement for future release/manual callers. The
caller-trigger regression fails before this fix (`caller-trust-before.log`).

## Local validation notes

Node and Bun each pass all 897 tests. Deno passes 894 with three existing runtime
capability skips (bin-symlink imports and two CDN command-stream cases).
The additional real preview-token regression fails against the original workflow
and passes under all three runtimes. Focused integration/regression suites pass. ESLint with all warnings enforced,
Prettier, jscpd, actionlint, regular/pedantic zizmor, workflow policy and status-gate
coverage checks pass. Root and example audits report zero vulnerabilities. Vite
build, global-agent proxy bootstrap and Electron directory packaging pass.

A broader `node --test` discovery run also found an old experiment's missing
package manifest. Adding its actual fixture package fixes all four failing
merge scenarios (`node experiments/test-changeset-scripts.mjs`). Supported suites
use the repository's configured runtime commands.

Relevant downstream fixes were reviewed from konard/voice-simulator PRs 4 and 8,
link-foundation/link-file-system PR 4, and the template's recent merged PRs. Adapted
changes retain the template package name, repository paths and independent tests.
