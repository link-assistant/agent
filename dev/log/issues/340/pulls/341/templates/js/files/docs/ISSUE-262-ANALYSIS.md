# Issue 262: requirement inventory, research, and verification

## Scope and execution plan

[Parent #262](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/262)
requires one PR for all six native children, #256–#261. The native sub-issue
endpoint confirms exactly those six. All seven issue bodies, their paginated
comments, and PR #263's conversation, inline comments, and reviews were read;
there was no additional feedback at the start. None of the children was already
resolved. No child or prose requirement is deferred.

The execution plan covers research, reproduction, implementation, local
verification, diff review, one coordinated push per batch, and same-revision CI
investigation. Work stays on the prepared
branch; PR #263 is updated and marked ready after validation. Merge, publication,
and deployment are separate actions and are not performed here.

## Requirements, alternatives, and chosen plans

| Source | Every requested behavior                                                                                                                                                                                                                                                                                                            | Alternatives considered and implementation plan                                                                                                                                                                                                                                                                                                                        | Verification                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #256   | Prevent the pinned scanner and preset being split between local node_modules and npx's tree. Configure a supported Node before scanning. Add an ordering regression.                                                                                                                                                                | Move scanning before install; alternatively install both scanner packages locally, or set NODE_PATH. Choose setup-node → pinned scan → npm ci in the lint job: keeps scanner packages out of the template dependency graph and scans before lifecycle scripts.                                                                                                         | `issue-262-regressions.test.js` pins order and existing versions; existing `experiments/issue-212-secretlint.mjs` checks clean, synthetic GitHub, and synthetic Slack fixtures.                                                                                                                                                                          |
| #257   | Repositories without optional .github/actions must pass policy validation; invalid workflows must still fail. Correct the terminal status-gate docstring from always() to !cancelled().                                                                                                                                             | Return [] for every missing directory, or only tolerate missing optional actions. Choose the latter, preserving errors for absent required workflows and other filesystem failures.                                                                                                                                                                                    | CLI test creates only .github/workflows, checks success, then inserts a floating runner and checks policy failure. Existing gate coverage tests remain.                                                                                                                                                                                                  |
| #258   | Eliminate unpinned executable CDN code and runtime helper installation from every release script, especially credentialed jobs; make reruns reproducible and preserve error propagation.                                                                                                                                            | Exact CDN URL plus SHA-384 and pinned runtime specs, or local lockfile imports. Choose literal local imports of exact-pinned command-stream 2.4.0 and lino-arguments 0.4.0, with package-lock integrity hashes. Freeze every release-workflow install with npm ci. Preserve bootstrap annotations, fallback outputs, namespace normalization, and shell.errexit(true). | Source/lockfile regression rejects CDN/eval across scripts and unfrozen workflow installs. Offline integrations load both real helpers, run a command, and assert nonzero rejection. Existing formatter integration retains content/PR/JSON-stdin assertions using test-only import hooks instead of a fake downloaded loader.                           |
| #259   | Make prepare work on Windows; retain outcome verification and skip behavior. Run meaningful hook tests on Windows instead of skipping all POSIX fixtures.                                                                                                                                                                           | Spawn a shell around npx, or call installed Husky's API. Choose Husky API: no shell/shim or package download. Preserve CI, HUSKY=0, and consumer skips, failure diagnostics including silent Husky, and Git hooksPath verification. Keep optional tracing off by default through CI_SCRIPTS_DEBUG.                                                                     | Shell-free injected unit tests cover all existing outcomes; a real git init test invokes prepare and verifies repository-local core.hooksPath plus generated hook existence on every OS/runtime.                                                                                                                                                         |
| #260   | Keep every shell script and hook at LF even with Windows/core.autocrlf=true. Add a policy test so future scripts are covered.                                                                                                                                                                                                       | Disable autocrlf in each workflow, filter carriage returns at execution, or set repository attributes. Choose \*.sh and .husky/\*\* text eol=lf globally, covering existing and future paths.                                                                                                                                                                          | Policy checks every tracked shell/hook with git check-attr and verifies bytes. `issue-262-crlf-checkout.mjs` exercises actual checkout filters in a disposable Git index with autocrlf=true.                                                                                                                                                             |
| #261   | Retry dropped connections, timeouts, 429, 5xx, and unreadable answers with backoff. Return confirmed absence immediately. Report permanent HTTP errors after one request. Distinguish exhausted lookup failures from no snapshots, give a rerun hint, and keep all_archived=false for unknown results. Export an injectable lookup. | Add an HTTP retry dependency, or a bounded loop around native fetch. Choose native fetch with three attempts, 2s/4s backoff, a 10s deadline per complete request/body read, schema checks, and preserved network causes. Separate archived, absent, and failed collections throughout CLI reporting.                                                                   | Mocked retry tests cover all transient categories, malformed schemas, permanent 403, empty snapshots, causes/backoff, and stalled requests/bodies. Offline CLI tests cover 429 recovery → snapshot/exit 0 and persistent 429 → lookup error/rerun/exit 1/output false without a false absence message. Existing local-link and parser assertions remain. |
| #262   | Read every issue/comment, implement all children in one PR, and repeat a positive closing keyword for the parent and each child. Explicitly identify already-fixed/unreproducible children.                                                                                                                                         | Maintain this inventory and a PR description with seven separate Fixes references. All six defects are present; the Windows failure mechanism is documented upstream and is validated by the hosted Windows matrix.                                                                                                                                                    | PR body and final diff review; all same-head CI workflows, including all nine runtime/OS combinations.                                                                                                                                                                                                                                                   |

## Root causes and online component research

The [npm exec documentation](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
explains local package reuse and installation of missing packages into npm's
cache. Secretlint's maintainers describe the resolver's installation-relative
behavior and the NODE_PATH workaround in
[secretlint #1624](https://github.com/secretlint/secretlint/issues/1624).
Together these explain why an existing local preset can be invisible to the
cached scanner. Moving the scan is sufficient on the fresh hosted checkout;
no upstream tool patch is necessary.

[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) validates the lockfile
and performs a frozen install. Registry metadata was checked for both selected
helper versions and their integrity hashes. Version 2.4.0 was selected over the
fresh 2.5.0 release so a fresh Deno install passes its minimum dependency age
policy without an override. The existing
[command-stream](https://github.com/link-foundation/command-stream) component
already implements streaming commands and errexit;
[lino-arguments](https://github.com/link-foundation/lino-arguments) supplies the
configuration API used by the scripts. Reusing them avoids replacing eight
callers' shell quoting and CLI configuration semantics. The default installed
loader only recognizes these two names; literal import specifiers prevent
runtime package/version selection. Dynamic import defers local loading for
bootstrap diagnostics; it does not fetch or install packages on Node.

[Node's Windows process documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)
confirms execFile cannot execute .cmd scripts directly.
[Husky's documented installation pattern](https://typicode.github.io/husky/how-to.html)
and its [9.1.7 API implementation](https://github.com/typicode/husky/blob/v9.1.7/index.js)
supply an existing shell-free entry point. Husky returns messages for some
failures, so retaining the independent Git configuration check matters.

[Git's attributes documentation](https://git-scm.com/docs/gitattributes)
defines eol=lf checkout behavior independently of core.autocrlf. Repository
attributes cover contributors and every CI checkout in one place.

The [Internet Archive availability API](https://archive.org/help/wayback_api.php)
documents archived_snapshots and closest. An empty archived_snapshots is a
successful absence response; a transport failure or malformed body provides no
such evidence. [p-retry](https://github.com/sindresorhus/p-retry) is an existing
component that supports exponential backoff and custom retry decisions. For this
single endpoint, native fetch, AbortController, and node:timers/promises provide
the needed bounded retry behavior without a new HTTP library. No live service
availability is used as a test oracle.

## Whole-codebase audit and preserved behavior

- The only active secrets-scan invocation is release.yml's lint job; historical
  case-study snapshots are evidence, not executable CI, and remain unchanged.
- All eight production consumers use scripts/use-module.mjs: changeset-version,
  create-manual-changeset, format-github-release, format-release-notes,
  instant-version-bump, publish-to-npm, setup-npm, and version-and-commit. Every
  active consumer now resolves installed helpers. Their comments were corrected.
  The offline outage experiment was updated to the new contract.
- Both credentialed release jobs, the manual changeset job, and validation jobs
  install frozen dependencies before helper consumers. The Bun test leg uses
  npm ci too: a frozen Bun install rejected migration from package-lock.json
  without a Bun lockfile, so using the existing npm lock avoids a third lockfile. The versioning script's
  package-lock-only refresh remains necessary after an intentional version bump.
- Every tracked `*.sh` and `.husky/*` path is checked; no per-workflow normalization
  workaround or assertion reduction was introduced.
- There is one active Wayback implementation. All CLI classifications, annotations,
  summary advice, exit codes, and all_archived output account for unknown lookups.
  Broken local files still fail, and recovered healthy URLs are still excluded.
- Interop shape assertions, command failure assertions, bootstrap fallback outputs,
  formatter content preservation, and hook failure/skip assertions remain.
  CDN fetch/retry-only tests are replaced by offline installed-helper tests because
  production no longer has a CDN loader. The obsolete Windows file-URL workaround
  and unsupported Deno CDN skip disappear with that loader.
- This batch changes native JavaScript and CI only. There are no incomplete ports,
  unsupported translations, carried behavior, or new native adapters. Existing
  JavaScript-first inventory/readiness and regenerate-and-diff requirements for
  the mixed-language example remain enforced; no Rust build is needed locally.

## Reproduction and validation record

Before implementation, the four repository regressions failed with scan ordering,
ENOENT, executable CDN loader, and missing LF attributes. The initial hook source
regression also found the npx spawn. A CLI fixture returning persistent HTTP 429
produced the incorrect “No archived version was found” message on the original
script. Logs are saved locally under ci-logs, with failed-output details preserved.

The implementation's first focused run passed all 37 tests: workflow regressions,
Husky outcomes/real repository, dependency namespace handling, offline helpers,
release formatting, and retry outcomes. Git's actual autocrlf checkout probe passed
for all 16 tracked shell/hook files. Full-runtime and final-candidate results are
recorded in the PR after execution. No Rust compilation or user-cache deletion is
part of this batch.

The first candidate, `e90ccc4`, passed all Linux and macOS runtime jobs, workflow
validation, security, link checks, and example builds. All three Windows runtime
jobs exposed the same new CLI-fixture defect: Node's `--import` received a Windows
drive-letter path instead of a file URL (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). The
[complete run](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/40106772039)
was collected before making the next batch; local saved-log lines 13226, 16751,
and 18436 identify that failure in Bun, Deno, and Node respectively. The actual
Windows hook installation, offline helper execution, and LF policy tests passed.
Both preload fixtures now convert their resolved paths to file URLs. Their CLI
assertions remain intact; final same-revision CI verifies the correction.
