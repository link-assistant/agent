# Issue 340: CI/CD evidence, causes and implementation

Repository: `link-assistant/agent`. Review: https://github.com/link-assistant/agent/pull/341.
All times below are UTC. This directory preserves raw evidence separately from
the conclusions drawn from it. No issue or PR attachments required image analysis.

## Scope and requirement inventory

The complete original issue is in `issue.json`; all issue comments, required
sub-issues, PR conversation comments, inline comments and reviews were retrieved.
The initial lists were empty; subsequent CodeQL inline review comments reported two real security defects, now covered below. The original issue requests a repository-wide audit,
not just making its two red badges green.

| Requirement | Implementation and verification evidence |
| --- | --- |
| Investigate all eight cited runs, including successful runs | `ci-logs/run-*.log`, `meta/run-*.json`, jobs/artifact metadata; timeline and diagnostic classification below |
| Fix false positives, false negatives, warnings and errors | Freshness policy, lockfile refresh, native DOMException adapter, source-size coverage, release/credential/version safeguards, artifact initialization and status-gate coverage |
| Compare full file trees and all workflow/CI helpers from JS, Rust and Python templates | Pinned `templates/*/{tree.json,inventory.txt,files/,comparison.md,content-review.json,comparisons/}`; 941 complete blob contents, including 227 CI/configuration files; all Git blob hashes verified |
| Reuse applicable best practices across the entire codebase | The 17-principle matrix below maps both language pipelines and all ten workflows |
| Report the same template defects upstream | `reports/`; JS template issues 289/290, Rust template issues 230/231, Python template issue 140 |
| Deep analysis, sequence of events, root causes, solutions and plans | This report, raw logs, `RESEARCH.md`, pinned template content and bounded before/after probes |
| Consider existing libraries/components | `RESEARCH.md`; reuse changesets, cargo-outdated, lychee, actionlint, zizmor, secretlint and existing shared release helpers |
| Reproduce bugs with regression tests | `js/tests/{ci-audit-340,dependency-freshness,release-safety,validate-changeset,check-pipeline-status,workflow-policy,rust-version-and-commit}.js`; `experiments/issue-340/reproduce-before-after.mjs` |
| Add off-by-default diagnostics when needed | Existing `PIPELINE_STATUS_VERBOSE=1` retained; change comparison/safe release synchronization expose `DEBUG=1`; registry probes never print tokens or remote bodies |
| Single PR, release preparation, no lost features | JS patch changeset and Rust patch changelog fragment; no manual version bump; existing language implementations and release recovery retained |
| Verify latest main, all checks, complete PR metadata and ready state | Final verification record and PR checks; merge main if it advances; do not merge this PR |

There were no required sub-issues in the issue's GitHub sub-issue list. Upstream
reports are reports of shared template defects, not a substitute for fixing agent.

## Timeline and reconstruction

| Time / commit | Event and implication |
| --- | --- |
| 2026-11-06 15:06, `dc8f9ea` | Free Model Drift run 42239835585 fails: Kilo withdrew `nvidia/nemotron-3-super-120b-a12b:free`. Log lines 256–258 name the exact alias and target. This is real external model withdrawal. |
| 2026-11-06, upstream lino-arguments issue 50 | The 0.4.0 CLI startup ambiguity report is closed after 0.4.1 fixes eager environment alias normalization. The old agent pin remains; `meta/lino-arguments-50.json` preserves the report and timestamps. |
| 2026-11-06 22:38, `b85b1f0` (#339) | Earlier work replaces the default Super model with Ultra and preserves Super as a deprecated compatibility alias. Successful model catalogue run 42306243941 validates the new defaults. The 15:06 failure describes an older tree. |
| 2026-11-06 22:38:51 | Freshness run 42306243946 fails at lines 619–649 after packages publish newer versions. The old lino-arguments pin is attached to a now-closed upstream issue. |
| 2026-11-06 22:38–22:41 | JS run 42306244000 passes but logs deprecated `node-domexception@1.0.0` and `glob@9.3.5` during installs (lines 2595–2596 and 9569–9570). Green does not mean warning-free. |
| 2026-11-06, `1b48e9c` | Rust v0.11.0 release is the prepared branch's default-branch base. Both JavaScript and Rust versions must remain CI-managed. |
| 2026-11-06 23:30:49 | Issue 340 opens, citing seven same-SHA runs plus the older drift failure. No issue comments add requirements. |
| 2026-11-06 23:31:38 | Prepared PR's placeholder SHA `2ec641c` triggers only Security. It cannot establish that the proposed CI changes pass. |
| 2026-11-06 23:59:52, `7795b58` | First implementation push starts all eight automatic workflows. npm freshness, model checks, links, lint, package install and live verbose logging pass. |
| 2026-11-07 00:00–00:03 | CI exposes a Docker argument quoting error, a newly published uuid 1.29.1 and a test expecting the former cancellation expression. Raw failing runs 42315443066, 42315443190 and 42315443019 are preserved; each is fixed, not waived. |
| 2026-11-07 00:15/00:22 | Seven workflows pass, but completed JS runs 42317054504 and 42317830891 fail in packed-parser verification because the prepare helper is outside the copied package. Unit-test success alone was insufficient. |
| 2026-11-07 00:35–00:40, `14c1899` | All eight workflows complete successfully, including package-copy prepare and both CodeQL fixes. |
| Final review, `7c81a90` | Reproduce release command false success; adopt strict, locked loader and verify API errors with 169 focused tests. |
| 2026-11-07 00:46–00:51, `7c81a90` | All eight Actions workflows succeed, but the separate CodeQL summary check 128243030845 fails on two incomplete-escaping operations in shared release scripts. Workflow success is not all-checks success. |
| 2026-11-07 00:58, `354f390` | Replace partial escaping with exact changelog heading comparison and direct Git argument passing; 172 focused tests pass. |
| 2026-11-07, `354f390` completed | All eight workflows and CodeQL summary succeed: 39 passing checks, five expected skips, zero CodeQL summary annotations. |
| Subsequent iterations | actionlint configuration moves to YAML; uuid updates only its lockfile entry; trace expectation follows the new policy. Final results are recorded separately from these historical failures. |

## Root causes, alternatives and chosen solutions

### 1. Dependency freshness and stale pin exceptions

The freshness failure has two dimensions: real package drift and a policy that
treated new upstream releases as a broken main-branch commit. The original log
contains a table of newer direct dependencies, followed by the closed-issue pin.
The pin was originally justified: lino-arguments 0.4.0 normalizes the complete
environment before any option requests it and throws on common `HTTP_PROXY` /
`http_proxy` aliases. Version 0.4.1 fixes that upstream cause.

Chosen plan, implemented: update direct npm dependencies and both lockfiles,
upgrade lino-arguments to ^0.4.1, remove its obsolete pin, keep the still-open
web-tree-sitter compatibility pin, and independently verify its GitHub issue.
Strict checks remain on PRs, schedules and manual runs. A main push reports
external freshness findings as warnings so a new upstream publication cannot
retroactively invalidate a tested release. Registry/tool/network errors still
fail on every event. Cargo uses distinct exit code 10 for outdated dependencies;
exit 1 and signals are infrastructure failures, not evidence of drift.

Alternatives: remove freshness entirely (loses useful regression coverage), or
ignore all nonzero cargo exits on main (hides broken tooling/network). Both are
rejected. npm rechecks the actual registry latest tag to avoid stale npm-outdated
cache results. Mocked tests cover the entire event/status/pin-verdict matrix.

The first PR run also found uuid 1.29.1. `cargo update -p uuid --precise 1.29.1`
updates only that package's version/checksum; full Rust validation runs in CI. Run 42317054461 passes npm and Cargo freshness at fdcf2ce.

### 2. Deprecated and vulnerable transitive dependencies

`fetch-blob` pulls node-domexception; Babel's resolver pulls old glob. Updating
only agent's direct glob dependency leaves Babel's old copy installed. The
baseline npm audit additionally identifies vulnerable transitive minimatch.

Chosen plan: root overrides resolve glob 14 and minimatch 11 throughout the
development graph. Supported Bun/Node already provide DOMException, so a tiny
local CommonJS adapter exports exactly the constructor fetch-blob expects.
The adapter is included in the npm files list. `meta/npm-audit-after.json`
reports zero vulnerabilities at every severity. A Babel alias transform, native
DOMException construction and fetch-blob content check verify compatibility.

An experiment with `@nolyfill/domexception` was rejected: it exports undefined
under this use and is not the node-domexception-compatible module. Existing
upstream PR nolyfill/nolyfill#123 proposes the dedicated adapter; its discussion
is saved, avoiding a duplicate report. The failed probe is retained alongside
the successful native adapter probe. No incompatible alias is shipped.

Overrides are a root installation policy; npm does not promise to apply another
package's overrides to a consumer root. The clean packed-package installation
job remains a separate check, and the native adapter introduces no public API.

### 3. Historical drift looked like an unresolved current failure

The cited drift run predates #339 by more than seven hours. Reverting the good
model fix or removing drift detection would create regressions. The fix already
shipped for the model itself: active defaults point to Ultra, old Super inputs
remain compatibility aliases, deprecated aliases are not required live models.

The remaining trigger gap is fixed here: changes to the model map/checker also
run drift on main pushes, so the UI can show current evidence immediately rather
than only the old scheduled failure. Catalogue failures/malformed responses are
still errors. Initialize the diagnostic log before installs and require its
artifact to exist even when the checker cannot finish.

### 4. Source-size and documentation checks missed most source

The old size checker ran from js/ and recognized only JS/MJS/CJS. It could pass
while three large TS files exceeded the stated source limit and while Rust or
shared helpers were unchecked. A 1501-line TS fixture passes the baseline and
fails the fixed checker (`meta/before-after.log`).

The replacement uses repository-owned files from Git and a common 1500-line
limit across JS, TS/TSX, Rust, shell and Python, excluding archived evidence and
external reference trees. ESLint and the pre-commit hook share that limit.
The three oversized TS modules are split along existing responsibilities:
auth interfaces/helpers/Google plugin, provider loaders/SDK construction, and
session prompt helpers. Runtime behavior remains covered by the existing tests.
Documentation has a separate 2500-line limit, required real section headings
and the existing link checker. A prose mention or table-of-contents link does
not satisfy a required heading.

### 5. Docs-only false negatives and avoidable build work

The JavaScript changeset validator rejected a docs-only PR with no release
fragment. A tiny Git fixture demonstrates baseline failure and fixed success.
Both language pipelines now detect relevant changes before credential/build
work, skip package checks for docs-only changes, and still validate docs/links.
Markdown source prompts and test fixtures count as code, so the optimization
cannot hide behavioral changes. Self-review added real Git regressions for runtime
Markdown and Rust-only changes: both failed before the shared relevant-change
policy was used by the JS changeset validator (`meta/changeset-scope-before.log`). Shared scripts, hooks and configuration changes
qualify both language pipelines. A release-only fragment also qualifies its
package so a manually requested release still receives validation.

The previous branch-name bypass for changeset checks is removed; a contributor
cannot exempt a code change by naming a branch like a release branch. Existing
unreleased fragments cannot satisfy a different PR's requirement.

### 6. Release work could publish code never validated by its run

Resetting the checkout to latest main after checks and unrestricted pull/rebase
can silently import new source/dependencies. `git add -A` also needs an explicit
boundary. Running `cargo generate-lockfile` during versioning can upgrade the
dependency graph after tests.

Chosen plan: preserve the validated checkout; allow synchronization only for
release metadata with equivalent manifests/locks after removing the package's
own version. Reject source/dependency changes with a message pointing at the
newer run. Reject non-metadata staged files, including executable files/config
inside fragment folders. Both JS version paths now update only the npm lockfile root version; Rust lockfile
versioning changes only the root crate's version, preserving tested transitive
resolutions. A real staged-Git regression rejects dependency edits even inside an
allowed lockfile. Safe metadata synchronization before JS recovery preserves
reruns of a partly completed release without importing newer source.

Lost-race pushes may retry a bounded three times after safe synchronization.
GH006/GH013/rule, authentication, permission and network failures fail immediately
with the original cause. Exact release tags are created after the push lands;
the real bare-Git race tests verify tag/main identity for a permitted metadata race and reject concurrent source with no version/tag pushed. The Rust template shares the unrestricted synchronization defect (report 231); the JS/Python templates already contain source attestation safeguards. Existing
incomplete-release recovery, registry visibility waits and version-specific
GitHub release creation remain in place. No force push or default-branch merge
is introduced by this PR. The removed test-job API-cache push was unreachable:
`data/` is ignored and no cache files are tracked, so the previous `git status`
condition never selected them. Cached reads/writes and all runtime features remain.

### 7. Credentials, manual versions and install failures could pass too late

Credential failure should be discovered before compiling a release. PRs have
report-only preflight and require no secrets; main requires a verified package
write credential. npm performs the official package-scoped OIDC exchange and
discards the token. The crates probe sends valid metadata but deliberately no
archive: only the exact authenticated `invalid tarball length` response verifies
credential/scope. Ownership remains cargo publish's final responsibility. All
unknown, throttled, malformed and unavailable probes remain unverified.

Manual publishing requires main and explicit successful prerequisite jobs.
Manual version changes in JS/Cargo manifests fail the PR guard on every branch
name. Installs use npm ci/Bun frozen lockfiles. Lint warnings are errors. The
Husky prepare adapter checks actual installation results instead of hiding all
errors behind `|| true`; intentional CI/HUSKY=0 skips remain supported. A bounded
probe also reproduced a stale-hooks-path false success in the JS template
(report 290); the adapter and regression reject any installation failure message.

### 8. Concurrency and workflow-tool compatibility

Read-only checks formerly stopped cancelling on main, retaining obsolete work.
All read-only jobs now cancel superseded work, independently per job and matrix
entry. All release writers use the same repository-scoped non-cancellable queue
with `queue: max`; serialization preserves each pending release attempt.
Existing cancellation-aware pipeline status reporting remains strict for genuine
timeouts and unexplained cancellations.

actionlint 1.7.12 does not yet recognize GitHub's documented queue property.
Existing upstream issue 657 / PR 654 cover that defect (issue 746 is a duplicate).
The workaround suppresses only this exact unknown-key diagnostic in JS/Rust
workflow paths, while regression tests validate writer placement/value and reject
cancellable queues. Docker action arguments do not parse shell quotes: the first
PR run proved that an inline spaced regex becomes filenames. YAML configuration
fixes this and keeps native/Docker execution consistent. Runners are explicit
ubuntu-24.04, macos-15 and windows-2025, rather than moving latest aliases.

## All 17 CI/CD principles mapped

| Principle | Repository application |
| --- | --- |
| 1 relevant changes | Both pipelines detect changes; all workflows have appropriate path/explicit manual/schedule triggers; runtime Markdown fixtures are preserved |
| 2 source size | All languages and helpers use 1500 lines; three large TS modules split; ESLint/hook synchronized |
| 3 formatting | Existing Prettier and cargo fmt retained; frozen installs and staged hook |
| 4 static analysis | ESLint warnings fail; clippy/rustdoc warnings denied; actionlint/zizmor retained |
| 5 fast-fail ordering | Changeset/version/preflight/lint before expensive tests/builds; publishers require explicit success |
| 6 changeset versioning | Docs exempt, code requires the PR's own fragment; JS/Rust patch release fragments added |
| 7 actual merge result | Fresh-base merge in language lint, test, package and build jobs; no PR-head-only test checkout |
| 8 pre-commit hooks | Formatting/lint retained; repository source-size check added; prepare no longer masks installation failures |
| 9 releases | CI-managed versions, main-only/manual defaults, metadata-only commits and dependency-preserving Rust lock updates; recovery retained |
| 10 concurrency | Read checks cancel superseded jobs on every branch; shared writer queue never cancels active writers; classified safe retry |
| 11 secrets | Existing whole-repository secretlint job and least-privilege permissions retained; probes avoid token output |
| 12 documentation | Size, required sections and lychee; archived raw evidence excluded |
| 13 container architecture | Conditional: agent releases npm/crates and native Rust binaries, not Docker images; native OS build matrix retained without introducing an unrelated container product |
| 14 workflow lint | Current actionlint, bundled ShellCheck, zizmor, narrow documented queue exception plus semantic policy tests |
| 15 dependency audits | Existing scheduled npm/Cargo lockfile audits and CodeQL retained; zero npm advisories after overrides |
| 16 publishing preflight | Main verifies npm/crates credentials before builds; PRs report without needing secrets; unknown is never pass |
| 17 changed world vs broken pipeline | Main external freshness warns; PR/schedule/manual enforce; real tool failures fail; artifact paths initialized; required dispatch defaults and release skip notices retained |


### 9. Security review and gaps exposed by exercising moved code

The CodeQL inline comments at discussion_r4498909254 and discussion_r4498909265
identify real defects inherited by the moved Google plugin. A loopback OAuth
callback interpolated the remote `error` parameter into HTML without encoding;
a hostname substring check accepted `generativelanguage.googleapis.com.attacker.invalid`.
The browser reproduction in `experiments/issue-340/oauth-callback.mjs` uses only
local requests and a bounded lifetime. Before the fix, the payload creates a
script element and sets `document.body.dataset.injected` to `true`. After encoding
HTML metacharacters, there are zero script elements and the payload appears as
literal text. Both screenshots are in `screenshots/`; the real callback regression
asserts HTTP 400, encoded content and authentication failure.

The production URL transformer now checks the parsed HTTPS protocol and exact
hostname. Both the original integration checks and adversarial URL cases import
the same production helper. It retains configured Cloud Code endpoints/versions.
No arbitrary-host substring implementation remains in executable agent code.

Exercising the real callback also found missing imports introduced during the
size-limit split: Google/OpenAI/Qwen OAuth helpers and the session shell executor.
The before/after binding scan records six unresolved references before and zero
after. Regression tests analyze transpiled runtime names in every split module;
real Google browser/manual and OpenAI initialization verify the affected paths.
The completed callback now clears its five-minute timer rather than holding the
process open. This is a correction to this PR's draft, not an upstream defect.

The manual JS release had retained a root-level CHANGELOG.md path even though
its package root is js/. The helper now writes the selected package changelog;
real temporary-directory regressions cover both single-package and js/ layouts,
entry ordering, and preservation of the unrelated root changelog. The current JS
template already handles this path correctly, so no duplicate upstream report
is warranted.

The packed parser probe exposed another PR draft regression: prepare referenced
`../scripts/install-git-hooks.mjs`, absent from its source-only package copy.
Logs 42317830891 lines 4004–4091 preserve the failure after 1226 unit tests passed.
The entry is now package-local under src/scripts and therefore included in both
source copies and npm tarballs. An isolated package copy runs the actual prepare
entry without the repository helper directory. Immutable third-party snapshots
under dev/log are excluded from CodeQL extraction, while all application source,
tests and workflows remain scanned.

### 10. Release commands resolved failures and loaded unpinned code

The final command-level review reproduced a genuine false success: without
`command-stream`'s `shell.errexit(true)`, a child exiting 7 resolves with code 7
and the release caller prints success. This bypassed catch blocks for failed
versioning, commits, Git pushes, formatting and GitHub API writes. Mocked push
failures alone had not exercised the actual command runner. The bounded probe
`experiments/issue-340/command-failure.mjs` records baseline exit 0 / code 7,
fixed exit 7 with captured stderr, and a real failed command reaching one rebase
and a successful second attempt. `meta/strict-command-before-after.json` preserves
all three results.

Chosen solution: adopt the JS template's existing strict shell setting in the
shared loader, so all nine release-script callers receive the same semantics.
Incompatible command-stream APIs fail explicitly. Captured error stdout/stderr
remain available to distinguish authentication errors from already-published
npm conflicts. A generic GitHub 422 is no longer accepted as an existing release:
a successful exact-tag/public-release lookup is required. Formatting skips only
an explicit HTTP 404 and propagates auth, network and malformed-response errors.
Tests cover these cases and both release workflow consumers.

The previous loader also fetched and evaluated an unpinned use-m CDN response
at release time. Adopt the template's installed-package approach: resolve only
the already-declared command-stream/lino-arguments dependencies from the frozen
js/package.json installation. Both Rust release jobs install the committed lock
before invoking shared GitHub release helpers. No new dependencies are needed.
The actual loader/command probe runs with fetch disabled, and the CLI help smoke
check exercises installed lino-arguments. Historical Node CommonJS namespace
normalization and CI_SCRIPTS_DEBUG diagnostics are retained. Existing upstream
use-m issue 72 and the current JS template already cover loader/strict-command
behavior; another template report would duplicate that work.

Alternatives: manually inspect every command result (easy to omit at a new
call site), catch and suppress all API errors (hides real release failures), or
keep runtime CDN loading (adds mutable code/network dependence after validation).
The existing library setting and installed loader cover all callers centrally.

### 11. Incomplete escaping and a separate failed CodeQL summary

The successful Security workflow at 7c81a90 uploaded its analyses, but GitHub's
separate CodeQL check still failed. Its exact check and annotations are preserved
in `meta/codeql-failed-{check,annotations}.json`. They identify
create-github-release.mjs:87 and version-and-commit.mjs:270. Escaping dots alone
leaves other regex operators active; escaping quotes alone does not escape
backslashes and unnecessarily mixes manual escaping with command serialization.

The offline actual-script probe `experiments/issue-340/release-notes.mjs` compares
7c81a90 with the working tree using a command adapter that only saves the release
JSON. For valid SemVer 1.0.1+build.1 the baseline silently loses the changelog and
falls back to "Release 1.0.1+build.1"; the fix preserves "Expected release notes".
The exact outputs are in `meta/release-notes-before-after.json`.

Chosen solution: compare JS/Rust changelog headings as literal version strings,
stop at the next level-two section and preserve nested change headings. The
existing changelog experiment now imports this production helper rather than
maintaining another partial-escaping implementation. Commit creation passes an
argument array to Node's existing execFileSync API, which preserves the message
literally and throws on failure. Regression tests cover build/prerelease versions,
prefix collisions, CRLF, metacharacters, both heading formats, and a real Git
commit containing quotes, backslashes and shell-like text. A second unstaged
commit proves failures still propagate. No extra package is required.

Alternatives: complete regex escaping or a purpose-built escaping library can
work, but exact string matching and argument arrays remove these escaping
boundaries entirely. This follows CodeQL's primary guidance in RESEARCH.md.
The final verification must inspect every PR check, including CodeQL's summary,
rather than infer all-checks success from the eight workflow conclusions.

## Evidence handling and verification

`experiments/issue-340/collect-evidence.py` preserves complete cited logs and
paginated job/artifact metadata without cloning three extra repository histories. Pinned archive streams preserve all
941 blobs, and each content is verified against its Git object hash.
The only cited-run artifact was the old model drift diagnostic, preserved under
`artifacts/42239835585/`. `compare-templates.py` reads large files in at most
1500-line chunks, records every template blob content/hash and emits individual content
diffs for files with agent counterparts; all 227 CI/configuration files receive applicability decisions. Applicability decisions
exclude template demo apps, sites, Docker products and JavaScript-first reference
architectures that agent does not ship; they do not remove existing agent features.

Raw command echoes, compiler `--cfg deprecated` flags, passing tests with words
like "error" and JSON release notes are not runtime warnings. The original
keyword sweep is retained as a lead list, not presented as 84 independent bugs.
Only observed diagnostics and reproduced policy holes are classified as causes.

Focused checks use mocks and small Git fixtures. Full cross-platform tests,
Rust compilation/builds, CodeQL and live model checks run on CI runners, avoiding
the local 2.92 GiB memory ceiling. Completed runs at fdcf2ce and 1e6dccb show seven passing workflows and a JS failure after its unit tests passed: the packed-parser fixture could not find the repository-level prepare helper. The complete logs, rather than intermediate job badges, establish this result. The helper now ships inside the package, with a standalone-copy regression. Final current-commit CI is recorded separately below.
GitHub refuses `gh pr diff` with HTTP 406 above 300 files; the error is preserved
in `meta/pr-diff-error.log`. Paginated PR file patches and the local source diff
provide the equivalent review, with archived raw logs/snapshots excluded from
product-code review.

The complete eight-workflow run at `14c1899` passed, including packed-parser
verification and CodeQL. Both PR CodeQL alerts 23/24 report fixed on the PR merge
ref; their full responses are preserved in meta/codeql-alert-*-fixed.json.
The command-loader and escaping changes pass 172 focused tests across 13 files,
ESLint, Prettier, source-size and actionlint checks. At 7c81a90 all eight workflows
passed but the separate CodeQL summary failed; 354f390 fixes both annotations.
At 354f390 all eight workflows and the separate CodeQL summary pass: 39 checks
pass and five expected jobs skip. The summary has zero annotations. Raw evidence
is in meta/verified-code-{checks,runs}.json and meta/codeql-fixed-{check,annotations}.json.

The product changes at 354f390 pass the complete current-SHA check set. All
implementation runs, including failures and successful follow-ups, are preserved
under ci-logs/ with job and artifact metadata. Latest issue comments and required
sub-issues are empty; both inline review defects and the later summary annotations
are fixed. The default branch remains 1b48e9c and is an ancestor of this branch.
The final evidence-only commit repeats the current-head check verification before
PR readiness; the live PR check URLs provide its authoritative latest result.
