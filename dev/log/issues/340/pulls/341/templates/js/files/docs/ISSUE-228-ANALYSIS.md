# Issue 228: requirements, research, and implementation plan

This single PR addresses parent issue #228 and all ten sub-issues, #218–#227.
The issue bodies, all issue comments, and all three PR comment endpoints were
read on 2026-10-10. The initial branch is based on main at `4973fc4`; the reported defects are present there. The root Deno lock already matches
package.json, as #220 states, so that part adds enforcement without regenerating
the lock. PR #229 initially has no reviews
or comments. No listed issue is deferred.

## Work checklist

- [x] Read parent, ten sub-issues, comments, contributing guidelines, recent PRs.
- [x] Search primary upstream documentation and downstream implementations.
- [x] Map each requirement and related occurrences across the repository.
- [x] Add minimal reproducing tests and save the failing baseline.
- [x] Fix workflow audit coverage and link input selection.
- [x] Fix release waits, package-manager diagnostics, and duplicate output.
- [x] Replace every silent test gate; enable full parallel Deno testing.
- [x] Fix shell fixtures, environment isolation, and working-directory mutation.
- [x] Validate install-script policy and jscpd configuration.
- [x] Add a patch changeset; run local checks before each implementation commit.
- [x] Run Node, Bun, full Deno, and read-only Deno; exercise CI-like environment.
- [x] Fetch/merge main, review the entire PR diff, and leave a clean working tree.
- [x] Update PR title/body and every closing reference; push only the issue branch.
- [x] Check fresh CI timestamps/SHA; preserve and investigate non-passing logs.
- [x] Verify all five workflows and nine matrix jobs on an implementation commit.

## Every requirement and the chosen solution

| Issue        | Requirement                                                                        | Alternatives and implementation plan                                                                                      | Verification                                                       |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| #228         | Fully read every listed issue, including comments                                  | Read each issue and paginated comments; include the extra environment/Windows cases from #222                             | This document and PR describe all ten fixes                        |
| #228         | Deliver all work in one PR                                                         | Use existing PR #229 and only `issue-228-dd3f51c33c49`; keep forward-moving commits                                       | Review final diff and branch                                       |
| #228         | Close parent and each child separately                                             | Use eleven separate `Fixes` lines, retaining the exact child closing block                                                | Inspect final PR body                                              |
| #228         | Explicitly state any already-resolved/unreproducible issue                         | Reported defects reproduce; the already-synchronized Deno lock needs a guard, and no Dependabot config currently ships    | Baseline and final validation records                              |
| #218         | Trigger audits on Dependabot configuration changes                                 | Explicit paths or `.github/**`; choose `.github/**` in both event filters to include future configs and composite actions | Assert both filters cover all audit inputs                         |
| #218         | Reproduction command must scan everything the action scans                         | `.github` or `.`; use `.` to match the action's default input exactly                                                     | Assert regular and pedantic commands scan the repository           |
| #218         | Any shipped Dependabot config must have at least seven cooldown days per ecosystem | No Dependabot config currently ships; retain full audit coverage for derived repositories                                 | zizmor's repository-wide audit                                     |
| #219         | Remove the always-empty HTML glob warning                                          | Dropping HTML only is fragile; use directory input with `--extensions md,html`                                            | Assert no globs and lone final `.`                                 |
| #219         | Ignore installed/untracked ignored dependencies and include hidden Markdown        | Directory traversal respects ignore files; add `--hidden`, keep all existing exclusions                                   | Real lychee input dump when available; config regression           |
| #220         | Distinguish Deno net denial from CDN outage                                        | Query the URL host permission before fetch; return permission state as skip reason                                        | Inject granted/prompt/denied permission states                     |
| #220         | Preserve HTTP/transport errors in skip reasons                                     | Return HTTP status or underlying cause; bound the probe                                                                   | Mock HTTP and transport failures                                   |
| #220         | Detect Deno lock drift on every runtime                                            | Compare all declared dependency ranges with workspace lock entries, normalizing equivalent zero-major caret ranges        | Test root lock metadata without spawning or network                |
| #221         | Give npm propagation a wide margin beyond observed 874 s                           | Deadline loop or more existing attempts; preserve polling design with 54 checks (1530 s)                                  | Fake clock: 950 s recovery, 1530 s exhaustion, one publish only    |
| #221         | Match Docker wait margin                                                           | Increase shared waiter to 154 checks: first check is immediate, so 153 sleeps span exactly 1530 s                         | Fake-clock waiter recovery and bounded failure                     |
| #221         | Report elapsed verification wait                                                   | Accumulate injected sleep duration; log success and exhaustion duration                                                   | Assert fake-clock log messages                                     |
| #221         | Preserve never-republish-after-success and definitive failures                     | Retain existing orchestration and custom retry overrides                                                                  | Existing conflict/retry tests and new tail-window regression       |
| #222         | Every runtime reports each unavailable test with a reason                          | Keep test-anywhere; use per-test `itUnless`, as `describe.skip` vanishes on Deno                                          | Node/Bun/Deno counts, read-only ignored names                      |
| #222         | Replace every registration gate and vacuous environment return                     | Audit all test files; adapt the existing downstream detector/codemod, then review manually                                | Guard scans every test file; minimum detector fixtures             |
| #222         | Prevent gates from returning                                                       | Guard all discovered test files, covering wrapped, swapped, describe returns, and environment returns                     | Guard must fail against original suite                             |
| #222         | Run Deno with full permissions and file concurrency                                | `deno test -A --parallel` in CI and current usage docs                                                                    | Workflow regression plus actual full Deno run                      |
| #222         | Avoid `process.chdir` in shared parallel workers                                   | Pass explicit cwd to child processes; guard both process/Deno chdir calls                                                 | Commit-message test and suite-wide guard                           |
| #222         | Shell fixtures launch Deno correctly                                               | Shell wrapper calls `deno run -A`; use `.cjs` for CommonJS fixtures                                                       | Execute shell fixture suites under Deno                            |
| #222 comment | Blank removed environment variables in synchronous child fixtures                  | Shared blanking helper; apply to CI/GitHub/Husky variables across suite                                                   | Guard against env deletion; Deno run with hostile CI env           |
| #222 comment | Respect Windows read-only Git object limitations                                   | Check for repository-aging fixtures; avoid utimes on read-only objects if present                                         | Codebase search and Windows CI                                     |
| #222 comment | Accept CRLF in workflow regexes                                                    | Normalize source reads or use `\r?\n`                                                                                     | Existing normalization plus Windows matrix                         |
| #223         | Review and approve the three example install scripts by package name               | Keep native build scripts enabled with `allowScripts` for electron-winstaller, esbuild, fsevents                          | Inspect installed lifecycle scripts; npm 11.19 clean install/build |
| #223         | Fail when any new lockfile install script has no decision                          | Derive policy requirements from every `hasInstallScript` entry, including optional OS packages                            | Cross-runtime policy assertion for each lockfile entry             |
| #224         | Pedantic zizmor must perform online audits                                         | Pass job-scoped `GH_TOKEN: ${{ github.token }}` to the pinned CLI                                                         | Workflow env assertion and authenticated local audit               |
| #224         | Both filters cover composite actions, Dependabot, and every executed script        | `.github/**` plus exact executed script paths, derived in a test                                                          | Automatic script extraction and both-filter assertions             |
| #225         | Use valid jscpd 5 comment-skipping configuration                                   | Replace ignored `skipComments` with supported `mode: weak`                                                                | Real installed binary must produce no unknown-field warning        |
| #225         | Catch future unknown config keys                                                   | Spawn installed jscpd on a small finite fixture using the actual config, fail on unknown fields                           | Regression test with bounded subprocess                            |
| #226         | Treat deno.lock as intentional when deno.json or deno.jsonc exists                 | Classify runtime-owned lockfiles; describe matching config in success output                                              | Both config fixture variants and real repository                   |
| #226         | Continue warning on all other foreign lockfiles and unowned Deno lock              | Keep declaration validation and unexpected-lock warnings                                                                  | Mixed owned/unexpected lock fixtures and missing declaration       |
| #227         | Print publish output once                                                          | Remove captured-output replay; retain live command-stream mirroring                                                       | Source guard and existing failure-detection tests                  |
| #227         | Keep captured output for detecting publish failures                                | Leave combinedOutput and exit-code analysis intact                                                                        | Existing publication tests                                         |

## Primary sources and existing components

- [zizmor usage](https://docs.zizmor.sh/usage/) and
  [integrations](https://docs.zizmor.sh/integrations/): repository inputs cover
  workflows, local actions, and Dependabot; online audits need a GitHub token.
  Keep the existing pinned zizmor 1.30.1 and action rather than adding a scanner.
- [lychee path exclusions](https://lychee.cli.rs/recipes/excluding-paths/) and
  [CLI flags](https://lychee.cli.rs/guides/cli/): directory traversal respects
  ignore files, `--hidden` includes dot paths, and extensions filter inputs.
- [Deno testing](https://docs.deno.com/runtime/fundamentals/testing/) and
  [permissions](https://docs.deno.com/api/deno/permissions/): `--parallel` runs
  test modules concurrently; permissions can be queried without making a fetch.
- [Deno configuration](https://docs.deno.com/runtime/reference/deno_json/):
  frozen locks are another enforcement option. A cross-runtime metadata guard
  catches drift on Node and Bun too, before Deno starts resolving dependencies.
- [test-anywhere #149](https://github.com/link-foundation/test-anywhere/issues/149):
  Deno's suite skip drops registration. Upgrading the framework alone does not
  fix the conditional tests. Reuse its consistently reported `it.skip` API.
- [Deno #35545](https://github.com/denoland/deno/issues/35545): an entry-point
  symlink resolves relative imports from the symlink directory. The CLI fixture
  reproduces this in Deno 2.9.6 and reports a named skip; Node and Bun execute it.
- [command-stream #219](https://github.com/link-foundation/command-stream/issues/219):
  the Deno CDN build has unsupported `createRequire` behavior. Its two real CDN
  integration tests report this reason after checking network permission first.
- [Deno #36996](https://github.com/denoland/deno/issues/36996): sync spawn merges
  environment; explicit blanking is the documented cross-runtime workaround.
- [npm install policy](https://docs.npmjs.com/cli/v11/commands/npm-install/) and
  [approve-scripts](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/):
  use npm's built-in named decisions; no install-policy dependency is necessary.
- [jscpd upstream](https://github.com/kucherenko/jscpd): the installed 5.4.0 binary's
  help/config parser supplies the authoritative `weak` mode behavior.
- [command-stream upstream](https://github.com/link-foundation/command-stream):
  capture retains live mirroring. Keep the existing executor and failure parser.
- [disk-space-saviour PR #32](https://github.com/link-foundation/disk-space-saviour/pull/32):
  reference implementation of visible skips, detector, env isolation, install
  policy, and workflow coverage. Adapt the helpers to this repository's fixtures.
- [hive-mind PR #2924](https://github.com/link-assistant/hive-mind/pull/2924):
  measured npm propagation tail and fake-clock tests. Existing injected sleep
  functions let this repository test a 25.5-minute wait instantly.

New runtime dependencies are unnecessary: existing test-anywhere and the
installed CI tools provide the needed APIs. The heuristic detector is deliberately
tested against this suite's source style; manual searches complement it for
multiline headers and dynamically loaded integrations.

## Validation and CI protocol

Save large outputs to logs and inspect relevant chunks (at most 1500 lines).
Retain reusable probes/codemods in `experiments/`. Use finite fixture sizes,
subprocess deadlines, and existing suite/job budgets. No publication is needed
to test the release changes.

For each pushed head, list the five latest branch runs with createdAt/headSha,
compare them to the latest commit, download every non-passing run under
`ci-logs/`, and identify exact failures by log line. Initial branch runs
38045043983 and 38045044177 both passed on `94e44d9`; most implementation
checks were skipped because that initial commit only contains task metadata.
Final validation must use the implementation SHA.

## Reproduction and local evidence

The focused regression tests were written before changing configuration or
scripts. The saved baseline has 145 tests, 38 failures, and no ignored tests.
The conditional-registration detector finds 58 silent gates in the original
suite and zero after conversion. To reproduce against the old tree, run the
new guard/regression tests with the original workflow/config/script files.

Full local runs use the same discovered 63 test files. Node 24 and Bun each pass
793 tests. Full-permission Deno registers the same 793, with 790 passes and three explicitly ignored tests:
the upstream Deno symlink failure and two unsupported command-stream CDN
integrations. There are no environment-gated suites or vacuous test passes.
Read-only Deno reports 607 passes and 186 ignored tests, each with its permission
reason.

The Deno fixture run sets CI=true and invalid GITHUB_BASE_SHA, GITHUB_BEFORE_SHA,
and GITHUB_AFTER_SHA values to reproduce runner environment leakage. It exposed
a second detector launcher that inherited those values; that launcher now blanks
all CI/GitHub fixture variables. Parametrized test registrations inside loops
were reviewed separately and converted along with ordinary test declarations.
The remaining Windows EPERM symlink case is probed before registration so it
reports a reason too. No repository-aging/utimes fixtures exist in this tree.

Real tooling validation: npm 11.19.0 installs the example without ignored-script
warnings; Vite builds successfully. The electron-winstaller lifecycle selects
the host's bundled 7-Zip, esbuild installs its platform binary, and macOS-only
fsevents rebuilds its native binding. All three have explicit named approvals,
including the optional fsevents entry absent from a Linux install. Authenticated
zizmor 1.30.1 regular and pedantic audits both report no findings. The pinned
actionlint Docker image (including shellcheck and pyflakes) exits successfully.
Lychee 0.24.2 dumps 15 inputs, includes .changeset Markdown, excludes installed
node_modules, retains every requested exclusion, and emits no empty-input warning.

The polling arithmetic is 2+4+8+16+50\*30 = 1530 seconds for 54 checks. The issue's
1500-second figure is a rounding mistake; both release polling and the immediate
Docker availability check plus 153 ten-second sleeps now span 25.5 minutes. Custom overrides
and terminal verification failure behavior remain covered by existing tests.

## Fresh CI fixture investigation

All five workflows ran on `b96f7d6` at 2026-10-10T10:55:17Z. Four passed.
The complete non-passing Checks and release run `38046587982` was preserved in
`ci-logs/checks-and-release-38046587982.log` (16,923 lines). Its three failures:

- Lines 15857–15864 (also 12773–12780 and 11526–11533): `bun install` creates
  an untracked `bun.lock`, so the package-manager test's checkout-wide
  no-warning assertion failed on all Bun platforms. The guard correctly warns;
  the test now uses isolated shipped inputs and retains unexpected-lock tests.
  `experiments/ci-lockfile-probe.mjs` reproduces the generated warning.
- Lines 11265–11317: Windows Bun's fake `gh` could not start (`ENOENT`).
  The fixture blanked uppercase PATH and populated mixed-case Path. Windows
  treats these as the same variable, and the child API chooses one. A minimal
  regression fails before the fix; every PATH alias now gets the same value.
- Lines 6340–6351: Deno/Windows reports `EBUSY` while removing the Changesets
  fixture after a 20-second child invocation. The fixture now uses async child
  execution, closes unused stdin, and unlinks the shared dependency junction
  before bounded cleanup. Windows CI verifies the actual platform behavior.

[Bun lockfile documentation](https://bun.com/docs/pm/lockfile) confirms automatic
lock generation; [Node child-process documentation](https://nodejs.org/api/child_process.html)
documents case-insensitive Windows environment keys and first-key selection.
Test and matrix-job time budgets remain unchanged.

A final call-site audit found the workflow's 1200-second publish and
1100-second Docker wrappers would truncate the new 1530-second polling span.
The new `ci-timeouts.test.js` regression fails on the old budgets
(`Expected 1200 to be greater than 1590`). Both publish steps and Docker's wait
now allow 1800 seconds. Release backstops become 65 minutes and Docker's
configuration job 45 minutes to preserve the existing 70% budget invariant.
Although #221 suggests keeping 50 minutes, its analysis omitted these wrapper
limits and the sum of sequential step budgets. Smoke-install defaults remain
unchanged: that distinct check follows successful registry verification.

Run `38047214301` on `c62775c` confirms all three Bun platforms now pass.
Deno/Windows still fails at lines 16528–16540 with cleanup `EBUSY` after
20 seconds. Child errors are now printed before cleanup so the primary failure
can be investigated without being masked by removal of a busy Windows tree.

The primary error in run `38047658950` on `3cb1736` appears at lines
11730–11736: the real Changesets CLI prints its version, then reaches its
20-second child deadline before cleanup raises EBUSY (lines 12176–12188).
The optional `experiments/trace-changeset-fixture.cjs` preload retains subprocess
commands and file paths on failure, without printing environment values or file
contents. It is disabled unless explicitly enabled by the release fixture.

All five workflows and all nine runtime/OS jobs pass on both `038f6ad` and
`20bf9e9`. However, the shared-tree Deno/Windows fixture still takes 18–21 seconds.
Inspection of [npm exec's implementation](https://github.com/npm/cli/blob/latest/workspaces/libnpmexec/lib/index.js)
shows that a missing local bin entry sends npm through dependency-tree loading
before it selects the command. This is a likely source of the delay with Deno's
automatically installed tree. The fixture now exposes only the real installed
Changesets CLI and Prettier, with explicit npm-compatible bin entries. It also
uses [npm offline mode](https://docs.npmjs.com/cli/v11/using-npm/config/#offline)
and disables installation prompts. This preserves the real version, changelog,
and formatting assertions while avoiding registry/cache behavior and shared-tree
inspection; the child deadline remains 20 seconds.

Run `38048743499` on `091007b` catches an invalid Windows-only bin shim:
the new launcher used `%~dp0%` instead of `%~dp0`, inserting a literal percent
into the Prettier path. Node and Bun report the real formatter failure at lines
8062 and 12856; Deno reaches its bounded child deadline at line 16597.
The real versioning test reproduces this on all three Windows runtimes.
The launcher now uses the documented
[Windows batch-parameter syntax](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/call#batch-parameters).
The existing matrix test verifies the corrected executable path.

The final upstream lockfile-table review also finds `upm.lock` before npm's lock.
The guard omitted it. Adding that lock to the existing mixed-lock fixture first
fails with `Expected ... to contain "upm.lock"`; the guard now recognizes it and
continues warning about every known unexpected package-manager lock.
