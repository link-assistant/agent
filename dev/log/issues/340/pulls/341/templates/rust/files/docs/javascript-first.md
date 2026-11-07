# JavaScript first and the single push gate

For mixed Rust/JavaScript projects, implement and debug complete behavior in native
JavaScript before compiling Rust. A browser UI, WASM wrapper, source envelope,
matching filename set or equal test count does not establish behavioral parity.

Maintain a feature inventory covering public APIs, CLI commands, errors, streams,
persistence and deployment contracts. Record missing, partial and carried items;
the production Rust gate must reject each. Use shared input/output fixtures and
independent native execution, including refusal and boundary cases.

Pin translation source and dependencies by immutable revision. Preserve typed meta IR (including Links
Notation) intermediates, source hashes, target artifacts and refusal reasons.
Regenerate into temporary output and compare tracked targets before Rust builds.
A successful source round trip establishes preservation of source text; execution
parity still requires observations from both native runtimes. Handwritten native
adapters must be explicit inventory entries with their own tests.

Use `.github/workflows/javascript-first-gate.yml` as a callable workflow. It
automatically detects tracked production JavaScript or TypeScript in the selected
`project-directory` (the repository root by default). Rust-only projects pass at
the checked revision without requiring a JavaScript implementation or commands.
Tool scripts, tests, fixtures, examples, experiments, documentation, configuration,
standalone `web/`, `frontend/`, `ui/` and asset directories, dependencies and
build directories do not imply a counterpart. Selecting an example
directory explicitly includes its production sources. Production sources in
`src/`, `lib/`, `javascript/`, `js/`, workspace packages and root entry points are
detected even without a package manifest; a missing manifest cannot bypass checks.
Only tracked files establish detection; the final clean-checkout guard also
rejects untracked source. Detection identifies a potential counterpart, not parity:
a detected wrapper must still prove the complete inventory before it can pass.
A standalone browser UI does not require a native port of the Rust application.

For a detected counterpart, supply real repository commands for the native suite,
strict readiness/parity inventory and regenerate-and-diff check through optional
workflow inputs, or define `javascript-first:native`, `javascript-first:parity`
and `javascript-first:translation` scripts in the selected root's `package.json`.
An existing script declaration keeps an adopted port gated even if its production
sources are removed; missing code must not turn an incomplete port into a bypass.
These scripts must install any needed dependencies themselves. Missing commands
fail closed. Explicit command inputs also opt in even outside detected locations;
they run relative to `project-directory`. Nested packages can use root scripts to
orchestrate all native implementations. The template supplies no default generator
or placeholder successful command. Depend on its successful
job with `needs:` before every Rust test/build/package/container/publish job;
consume its `tested-sha` output to bind the checkout. Event-revision jobs also
require that output to equal `github.sha` and check out that event commit.
Release-tag consumers check HEAD against `tested-sha` immediately after checkout,
before any toolchain, native action or build can execute. A skipped gate is not success.
For projects whose JavaScript port is unfinished, keep the readiness gate red and
report the blockers rather than representing the rollout as complete. Adoption of
this workflow does not by itself migrate this template's Rust-only sample.
The root CI, security, workflow-tool and desktop Rust jobs already depend on this
automatic prerequisite and check out its `tested-sha`; the independent example is
excluded from root detection. Release writers revalidate after versioning and
expose that candidate SHA to the container prerequisite. Desktop release tags are
resolved to an immutable SHA before validation. Fresh-merge checks also validate
their newly generated revision before compiling.

The prerequisite validates provenance from its own workflow checkout before
checking out candidate code. A PR run uses the PR cache scope. In other contexts,
an alternative to the trusted event SHA must be reachable from the repository's
default branch, fetched by the bootstrap checkout. This permits committed release
candidates and older releases while refusing arbitrary branch commits in a
default-branch cache context. Preserve this trust check when adapting the workflow;
a forty-character SHA alone does not establish trusted provenance.

Avoid `workflow_run` when same-workflow `needs:` or reusable workflows suffice.
If a separate workflow is required, check the source conclusion, repository/event
trust, exact `head_sha` and artifact provenance; default `GITHUB_SHA` refers to the
default branch rather than the initiating run. Keep untrusted PR execution read-only.

Read-only CI checks may run in parallel after the JavaScript prerequisite. Give
active releases, deploys, tag writes and generated-content pushes one shared
repository writer group with `cancel-in-progress: false`; check cancellation must
not interrupt publication. Reconcile current remote state before each write.

Draft changes in bulk. Workers may inspect, edit and run bounded JavaScript checks,
but exactly one coordinator owns git push. That coordinator stages a complete
batch, verifies the exact candidate revision with required local checks, inspects
the diff and pushes once. Wait for required same-revision CI before another push;
combine all observed failures into the next batch. Push permission does not imply
permission to merge, publish, deploy or clean user-owned caches.

Bound expensive local work: avoid duplicate profile/target/feature configurations,
share compatible build caches, limit compiler processes, measure wall time and disk,
and stop when the agreed budget is exhausted. Never silently reduce production
assertions, treat partial runs as green, or delete unrelated caches to regain space.

References: [router issue 759](https://github.com/link-assistant/router/issues/759),
[GitHub needs semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds),
[GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[Cargo build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html).

## Executable example and adoption

`examples/javascript-first/` is a small, independent checked-i32-addition API.
It includes native JavaScript, shared success/refusal/boundary fixtures, a typed
JSON IR, a deterministic dependency-free translator and a strict inventory.
SHA-256 hashes pin the native source, IR, fixtures and translator in `parity.json`.
The translator refuses unsupported IR and unpinned inputs. The inventory names
Rust's i32 input adapter explicitly; native invalid-input fixtures exercise that
refusal while Rust tests observe the representable inputs and overflow cases.
Compile-fail doctests also verify Rust rejects fractional and out-of-range input.
This inventory covers this example's API only. Extend the inventory and fixtures
to every feature of your actual application before adopting it for production.

Run the prerequisite checks without installing Rust:

```sh
node --test examples/javascript-first/native.test.mjs scripts/*javascript*.test.mjs experiments/issue-196-*.mjs
node examples/javascript-first/check-parity.mjs
node examples/javascript-first/generate.mjs --check
```

The example caller is `.github/workflows/javascript-first-example.yml`. It runs
`project-directory: examples/javascript-first` through the reusable gate, which
detects its native source and runs its three package scripts. Only success
schedules the Rust
job (tests, build, packaging and publish dry run) and the container build. Both
check out `tested-sha`. The failure tests cover native failure/skip exit, absent
commands, missing/partial/carried inventory entries, stale source hashes,
generated drift and a mismatched revision, and check every downstream dependency.
A workflow-level skipped gate also prevents those jobs through their explicit
`needs` and success condition. No toolchain is installed in the prerequisite.

For a release that generates a new candidate commit, pass its full SHA as the
reusable gate's `source-sha` from the trusted candidate-generation job. Validate
that candidate through this same gate before any compilation, package, container
or publishing operation. The example uses its PR/push event revision. It does
not accept arbitrary checkout revisions in a default-branch dispatch: untrusted
code must execute in a context that cannot poison the default branch's caches.
Actual publishing remains a separately authorized writer operation, serialized
with other writers and bound to that tested candidate. The example only performs
`cargo publish --dry-run`; it does not publish its demonstration package.

When changing behavior, update native tests first, then native implementation,
fixtures and IR. Review any newly required adapter or refusal. Update the pinned
hashes only for reviewed source/translator changes, run the generator, and commit
its output with the inventory. The gate requires a clean worktree after checking;
commands must generate temporary artifacts outside tracked source or in ignored
build directories. A caller cannot substitute a source round trip or placeholder
command for executable native checks and complete feature parity.
