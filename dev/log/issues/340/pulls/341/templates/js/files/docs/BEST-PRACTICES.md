# Best Practices for AI-Driven Development

This document describes CI/CD best practices that significantly improve the quality and reliability of AI-driven development workflows. When properly configured, AI solvers are forced to iterate with CI/CD checks until all tests pass, ensuring code quality meets the highest standards.

## Why CI/CD Matters for AI Development

AI-driven development creates a powerful feedback loop:

1. **AI creates a solution** - The solver generates code based on issue requirements
2. **CI/CD validates the solution** - Automated checks verify code quality
3. **AI iterates until passing** - The solver fixes issues until all checks pass
4. **Quality is guaranteed** - No code merges without passing all gates

This approach ensures consistent quality regardless of whether the team consists of humans, AIs, or both.

## This Template's Best Practices

This template implements the following best practices from the [hive-mind](https://github.com/link-assistant/hive-mind) project:

### 1. File Size Limits

**Maximum of 1500 lines per code file** (enforced via ESLint `max-lines` rule).

This constraint benefits both AI and human developers:

- AI models can read and understand entire files within context windows
- Humans can navigate and comprehend files without cognitive overload
- Forces modular, well-organized code architecture

### 2. Automated Code Formatting

Consistent formatting eliminates style debates and reduces diff noise:

| Tool     | Purpose                      |
| -------- | ---------------------------- |
| ESLint   | Code quality and style rules |
| Prettier | Code formatting              |
| Husky    | Pre-commit hooks             |

### 3. Static Analysis & Linting

Catch bugs and enforce patterns before code reaches review:

- ESLint with strict rules
- Strict unused variables rule (no `_` prefix exceptions)
- Async/await best practices enforcement

### 4. Comprehensive Testing

Tests run across multiple dimensions:

- **Cross-runtime**: Node.js, Bun, and Deno
- **Cross-platform**: Ubuntu, macOS, and Windows
- **Test framework**: [test-anywhere](https://github.com/link-foundation/test-anywhere) for universal compatibility

### 5. Changeset-Based Versioning

The changeset system:

- **Eliminates merge conflicts** - Each PR creates an independent changeset file
- **Automates version bumps** - Highest bump type wins when merging
- **Generates changelogs** - Release notes are compiled automatically
- **Supports semantic versioning** - patch/minor/major bumps are explicit

### 6. Pre-commit Hooks

Local quality gates prevent broken commits from reaching CI:

1. Format check and auto-fix
2. Lint and static analysis
3. File size validation

### 7. Release Automation

Automated release workflows ensure:

- **No manual version management** - Versions update automatically
- **OIDC trusted publishing** - No API tokens needed in CI
- **Validated releases only** - All checks must pass before publishing
- **Dual trigger modes** - Both automatic (on merge) and manual (workflow dispatch)
- **Optional Docker Hub publishing** - Projects with Docker images can publish version-matched Docker tags after npm package availability is confirmed

### 8. CI/CD Pipeline Features

The workflow implements several critical features from hive-mind issues #1274 and #1278, plus template reliability fixes:

#### Concurrency Control

```yaml
# Read-only job: newer work on the same ref supersedes stale work.
concurrency:
  group: check-${{ github.workflow }}-${{ github.ref }}-lint
  cancel-in-progress: true

# Write/deploy job: all repository writers use one protected queue.
concurrency:
  group: main-writer-${{ github.repository }}-main
  cancel-in-progress: false
```

Concurrency is configured at job level rather than workflow level. This
separation ensures:

- **Read-only jobs**: New pushes cancel stale checks on both pull requests and `main`, reducing runner load.
- **Dependent writers**: A cancelled prerequisite prevents its release or deploy job from starting.
- **Active writers**: Release, Docker, Pages, changeset-PR, and generated-preview jobs all share one non-cancelling queue, so a newer workflow cannot interrupt a write already in progress.
- **Matrix checks**: Runtime and operating-system values are part of the group, preserving parallel matrix execution while cancelling only the matching stale entry.

Do not apply cancellable concurrency at workflow level when a workflow contains
write jobs: cancelling the workflow would also terminate a publisher that has
already started. Likewise, do not use one shared group for every read-only job,
because unrelated checks would cancel each other instead of running in
parallel. GitHub Actions concurrency blocks support only `group` and
`cancel-in-progress`; options such as `queue` are invalid. With
`cancel-in-progress: false`, GitHub preserves the running job and manages one
pending job for the group.

See [DETAILED-COMPARISON.md](./case-studies/issue-25/DETAILED-COMPARISON.md) for the full analysis of best practices from both repositories.

#### Pushing to a `main` That Refuses Direct Pushes

Every job that writes to `main` pushes through
`scripts/push-main-with-rebase-retry.mjs`, which classifies a rejected push
before it reacts:

- **Lost race** (`! [rejected] main -> main (non-fast-forward)`) — another main
  writer pushed first. The helper rebases onto the new remote head and pushes
  again.
- **Repository rule violation** (`GH013: Repository rule violations found`,
  `Changes must be made through a pull request`, or the legacy `GH006`) — the
  branch refuses direct pushes. No rebase can satisfy a rule, so the helper
  pushes the same commit to a run-scoped branch, opens a pull request, merges it
  with `--merge`, and fast-forwards the checkout to the merged `main` so later
  steps in the same job see the merged tree.

Both rejections print "rejected", so the classification matters: reading a rule
violation as a race makes a release die after the version bump has already been
committed in the runner, with a log that blames a race that never happened
(link-foundation/js-ai-driven-development-pipeline-template#143).

The release and instant-release jobs prefer a dedicated `RELEASE_PR_TOKEN` when
configured. This can be a fine-grained PAT or short-lived GitHub App token with
Contents and Pull requests write access plus Checks read access. Without it,
the helper uses the built-in `GITHUB_TOKEN`. Pull requests opened by that token
do not start ordinary `pull_request` workflows, so the helper first proves the
version commit is a direct child of the validated workflow SHA and changes only
release metadata. It creates a successful `Pipeline Status` check on the exact
new SHA, linked to the validating run. The release jobs have `checks: write` for
this purpose; GitHub Actions must be allowed to create pull requests in the
repository settings. Additional exact metadata paths may be set through
`RELEASE_METADATA_PATHS`. The helper then waits for all required checks with
`gh pr checks --required --watch --fail-fast` before merging. Unexpected paths,
API denials, failed checks, and merge-policy errors fail closed.

The temporary branch is never force-pushed and never deleted, so it stays
compatible with rulesets that forbid destruction on `~ALL` refs, and the merge
never assumes squash or rebase is allowed. Generated commit messages must not
contain a skip-checks marker because required checks would then remain pending.

#### Fresh Merge Simulation

Before running checks on PRs, the workflow:

1. Fetches the latest base branch
2. Attempts to merge it into the PR branch
3. Runs checks against the merged state

This prevents "stale merge preview" issues where checks pass on outdated code.
The simulation logic is extracted to `scripts/simulate-fresh-merge.sh` for reuse across jobs.

### 9. Fast-Fail Job Ordering

**Run fast checks before slow checks** to give the fastest possible feedback:

```
Fast checks (~7-30s each):     Slow checks (~1-10 min each):
├── test-compilation           └── test matrix (3 runtimes x 3 OS)
├── lint (format + ESLint)
└── check-file-line-limits
```

Slow test matrix only runs after all fast checks pass. This dramatically reduces feedback time for AI solvers — a syntax error is caught in ~7 seconds instead of waiting for the full test matrix.

### 10. File Line Limits in CI

In addition to the ESLint `max-lines` rule (which only covers the source files it lints), a separate CI check enforces the 1500-line limit on:

- All JavaScript files (`.js`, `.mjs`, `.cjs`, including scripts)
- All Markdown files (`.md`, including documentation)
- `.github/workflows/release.yml` (to prevent workflow bloat)

This is enforced by `scripts/check-file-line-limits.sh`. Case-study and generated-data files under `docs/case-studies/*/data/` are exempt because they mirror external sources verbatim (the same paths are ignored by ESLint).

### 11. Secrets Detection

Automated scanning for accidental credential leaks using [secretlint](https://github.com/secretlint/secretlint):

- Runs in the lint job to catch secrets before code reaches review
- Configured via `.secretlintrc.json` with recommended rules
- Prevents API tokens, passwords, and private keys from being committed

### 12. Documentation Validation

Documentation files are validated in CI just like code:

- File size limits (1500 lines, enforced by the `check-file-line-limits` job alongside JavaScript files)
- Required files check (README.md, CHANGELOG.md, CONTRIBUTING.md, BEST-PRACTICES.md)
- Only runs when documentation files change

### 13. Reasonable Timeouts on Every Job and Test

Every CI job declares an explicit `timeout-minutes`, sized at roughly
5-10x the typical run time for that job. This keeps feedback fast when
a test, network call, package install, or release step hangs:

- Fast checks fail within 5-10 minutes instead of waiting for GitHub
  Actions' six-hour default.
- Matrix test jobs have a 10-minute cap per runtime and operating
  system.
- Release jobs have 50 minutes for package registry and GitHub API
  retries without allowing an unbounded release run.
- The broken link checker has 10 minutes for slow external hosts and
  Web Archive fallback probes.

Current timeout bands:

| Job                       | Cap    |
| ------------------------- | ------ |
| `detect-changes`          | 5 min  |
| `test-compilation`        | 5 min  |
| `check-file-line-limits`  | 5 min  |
| `version-check`           | 5 min  |
| `validate-docs`           | 5 min  |
| `changeset-check`         | 10 min |
| `lint`                    | 10 min |
| `test` per runtime and OS | 15 min |
| `links.yml` link checker  | 10 min |
| `changeset-pr`            | 10 min |
| `release`                 | 30 min |
| `instant-release`         | 30 min |
| `docker-publish`          | 30 min |

`timeout-minutes` is a backstop, never the deadline: GitHub reports a
job it kills as **cancelled**, not **failed**, so the overrun can pass
unnoticed on a pull request. Long steps therefore own an explicit
budget through `scripts/run-with-budget-warning.sh` (or a step-level
`timeout-minutes` for `uses:` steps), and `tests/ci-timeouts.test.js`
asserts every budget stays at or under 70% of the job cap it sits
under. See [CI-TIMEOUT-BUDGETS.md](CI-TIMEOUT-BUDGETS.md).

Per-test timeouts are also enforced inside the runners that support a
global budget:

```bash
node --test --test-timeout=30000 tests/*.test.js
bun test --timeout 30000
```

These bound an _individual_ test, not the suite: 25 tests of 29s each
pass every per-test check. The step budgets above are what bound the
whole run.

Deno does not currently provide an equivalent single global per-test
timeout flag, so Deno tests are protected by their step budget and the
matrix job backstop.

### 14. Proper Cancellation Propagation

Use `!cancelled()` instead of `always()` in job conditions (hive-mind issue #1278):

```yaml
# Bad - always() prevents cancellation from propagating
if: always() && needs.lint.result == 'success'

# Good - !cancelled() allows cancellation to propagate
if: !cancelled() && needs.lint.result == 'success'
```

When a workflow run is cancelled, `always()` still evaluates to `true`, causing dependent jobs to run unnecessarily. `!cancelled()` properly stops the chain.

## Quality Enforcement Strategy

The template implements a defense-in-depth approach:

```
Developer Machine    ->    CI/CD Pipeline               ->    Release
├── Pre-commit hooks      ├── Fast checks (~7-30s)           ├── All checks pass
├── Local tests           │   ├── test-compilation           ├── Version bump
└── IDE integration       │   ├── lint + secrets scan        ├── Changelog update
                          │   └── file line limits           └── Publish package
                          ├── Slow checks (~1-10 min)
                          │   └── test matrix (9 combos)
                          ├── Documentation validation
                          ├── Optional Docker Hub publish
                          └── Changeset verify
```

Each layer catches different issues, ensuring no problematic code reaches production.

## References

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [hive-mind CI/CD Best Practices](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md)
- [hive-mind CI/CD Case Studies](https://github.com/link-assistant/hive-mind/tree/main/docs/case-studies)
- [Issue #1274 Analysis](./case-studies/issue-25/data/issue-1274-case-study.md) - Concurrency blocking
- [Issue #1278 Analysis](./case-studies/issue-25/data/issue-1278-case-study.md) - always() cancellation prevention
- [Issue #29 Analysis](./case-studies/issue-29/README.md) - CI/CD best practices alignment
