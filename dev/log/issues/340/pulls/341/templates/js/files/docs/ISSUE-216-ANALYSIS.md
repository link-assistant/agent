# Issue 216: release formatting and changeset moves

## Scope and investigation

Parent [#216](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/216)
requires one PR covering [#214](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/214)
and [#215](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/215).
All three issue bodies, their paginated comment endpoints, and PR 217's
conversation comments, inline comments, and reviews were read. There were no
additional comments at investigation time on 2026-10-07. Recent merged PRs 213
and 204 provide the existing guard, Changesets 3, test, and release conventions.

Both bugs reproduce at `1e43fdb`, the base of this PR. Neither is already resolved
or deferred. The initial targeted regression run had 23 passing tests and seven
failures, including real `spawn deno ENOENT`, moved-fragment false acceptance in
both supported layouts, and move-plus-addition miscounting. After the fixes, all
30 tests in the two targeted files pass.

## Every requirement, alternatives, and implementation plan

| ID  | Requirement                                                                             | Possible solutions                                                                 | Selected plan and validation                                                                                                                               |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Read every listed issue and all comments.                                               | Issue view and paginated comments API.                                             | Read parent, children, and all three PR comment/review types.                                                                                              |
| P2  | Fully implement both issues in one PR without follow-up deferral.                       | Separate atomic fixes on the prepared branch.                                      | PR 217 includes configuration, CI, parser, guard, documentation, and regression tests.                                                                     |
| P3  | Close parent and both children on merge.                                                | GitHub closing keywords in the PR body.                                            | Separate `Fixes #216`, `Fixes #214`, and `Fixes #215` lines.                                                                                               |
| P4  | Use the children's closing block verbatim, one keyword per issue.                       | Separate closing lines.                                                            | Include `Fixes #214` immediately followed by `Fixes #215`.                                                                                                 |
| P5  | Explicitly report already-resolved or non-reproducible issues while keeping references. | Document reproduction findings.                                                    | Both issues reproduce; say so in the PR and preserve every closing reference.                                                                              |
| F1  | Make Changesets 3 versioning succeed without Deno installed.                            | Pin Prettier; install Deno; disable formatting; remove Deno config; downgrade CLI. | Set `format: "prettier"` centrally; execute real versioning with Deno absent.                                                                              |
| F2  | Update the config schema to the installed version.                                      | Update URL; remove schema.                                                         | Reference config 4.0.1 and assert the URL matches the installed package.                                                                                   |
| F3  | Keep generated changelogs consistent with `format:check`.                               | Prettier; disabled formatting with a separate format stage.                        | Reuse installed Prettier and check the generated manifest and changelog.                                                                                   |
| F4  | Add a real CLI regression in a temporary copy with Deno removed from PATH.              | Integration fixture; mocked formatter.                                             | Copy actual package/runtime/formatter config, link dependencies, assert Deno cannot spawn, run CLI, check version, changelog, consumption, and formatting. |
| F5  | Validate versioning before merge without publishing credentials.                        | Dedicated job; independent lint step.                                              | Run the release wrapper on PRs after fresh merge and installation; restore generated metadata and fragments with an EXIT trap.                             |
| F6  | Prevent release-preflight credential failures from hiding versioning failures.          | Remove credential guards; decouple versioning validation.                          | Keep authentication checks and run PR validation in lint, whose only dependency is change detection.                                                       |
| F7  | Correct the package-manager guard's misleading header; keeping the guard is optional.   | Remove it; keep precise explanation.                                               | Retain npm declaration protection; distinguish package-manager commands from direct formatter selection.                                                   |
| G1  | An unchanged move of a pending fragment must not count as a new fragment.               | Compare added/deleted blobs; exact rename detection.                               | Use `--find-renames=100%`, parse `R100`, count only `A`; test root and `js/`.                                                                              |
| G2  | A genuinely new fragment replacing a similar deleted fragment must count.               | No rename detection; exact detection.                                              | Exact detection leaves changed replacement content as `D` plus `A`; test shared frontmatter and similar content.                                           |
| G3  | Both sides of moves must influence whether code requires a fragment.                    | Second no-renames diff; expand both paths from one diff.                           | Return source `oldPath` and destination `path`, flatten both before exemptions; test code-to-docs and docs-to-code moves.                                  |
| G4  | Parse NUL-separated rename records and subsequent entries correctly.                    | Git parser dependency; extend existing parser.                                     | Consume three fields for rename/copy records and two otherwise; test moves followed by additions, spaces, and Unix tabs.                                   |
| G5  | Preserve existing guard behaviors and supported layouts.                                | Targeted changes to shared helper and consumer.                                    | Retain merge-base resolution, unavailable-ref failures, trusted release identities, exactly-one enforcement, and path exclusions; run full guard suite.    |
| A1  | Apply fixes across the entire codebase.                                                 | Inventory configurations, version callers, and Git diffs.                          | Central config covers all callers; update sole PR-change consumer and the incomplete older experiment; retain unrelated attestation semantics.             |
| A2  | Research existing components and requirement-specific plans.                            | Official docs, installed source, upstream discussions, downstream examples.        | Reuse Changesets, Prettier, Git, and test-anywhere; no new dependency. Sources and alternatives below.                                                     |
| A3  | Prepare the next release.                                                               | Patch changeset; manual version bump.                                              | Add exactly one patch fragment; established automation manages version fields.                                                                             |

## Root causes and primary-source research

Changesets documents `format` as defaulting to `auto`, with explicit formatter
selection supported. Installed versions are CLI 3.0.3, config 4.0.1, and format
0.1.2. Installed source checks formatter configs in the order dprint, Deno,
oxfmt, Biome, Prettier. A bare `deno.json` selects Deno regardless of a `fmt` key.
Deno formatting spawns the executable directly, bypassing package-manager
selection. The npm declaration therefore cannot fix formatter discovery.
[Changesets configuration](https://changesets.dev/guide/config#format),
[formatter source](https://github.com/changesets/format/blob/main/src/formatters.ts),
[detection source](https://github.com/changesets/format/blob/main/src/detect.ts).

The upstream maintainer recommends explicitly selecting Prettier for this case.
PR 46, merged 2026-09-25, removes the redundant `fmt` check while retaining
filename-based detection. Waiting for that upstream change would not fix this
template.
[maintainer response](https://github.com/changesets/format/issues/45#issuecomment-5570188298),
[upstream PR 46](https://github.com/changesets/format/pull/46).

Git documents `--find-renames=100%` as exact-only detection. The NUL-separated
name-status format preserves filenames and supplies two paths for rename
records. Default similarity detection can pair different fragments with similar
frontmatter; no-renames instead reports an exact move as deletion plus addition.
Exact detection solves both without maintaining two comparisons.
[Git diff options and output format](https://git-scm.com/docs/git-diff).

## Existing components and alternatives

| Component or approach               | Capability and decision                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changesets CLI and format           | Existing versioning and formatter configuration API; use supported settings and test the installed CLI without dependency patches.                                                                                           |
| Prettier                            | Already installed and configured; use it for release output and generated-file checks. [CLI reference](https://prettier.io/docs/cli#--check).                                                                                |
| Git exact rename detection          | Already required by guards; distinguishes moves from new content and supplies both paths without an extra parser or hash database.                                                                                           |
| test-anywhere                       | Existing Node/Bun/Deno framework; subprocess integration runs on Node/Bun, read-only assertions also run under Deno.                                                                                                         |
| command-stream regression           | Adapt its real CLI fixture to this repository's framework and add output-format checks. [Downstream test](https://github.com/link-foundation/command-stream/blob/issue-216-fe6e9f11097a/js/tests/changeset-config.test.mjs). |
| Install Deno for releases           | Adds a runtime and formats with a different tool from format:check; explicit Prettier directly fixes selection.                                                                                                              |
| `format: false`                     | Avoids formatter execution but needs a separate formatting stage for generated output.                                                                                                                                       |
| Remove Deno config or downgrade CLI | Removes supported runtime testing or reverses existing tooling work.                                                                                                                                                         |
| Two Git diffs                       | Valid alternative: no-renames paths plus exact-renames additions. One parsed exact-rename diff preserves both with fewer subprocesses.                                                                                       |

## Whole-codebase audit

- `.changeset/config.json` is the only Changesets config. Pinning it covers direct
  CLI operations, `scripts/changeset-version.mjs`, `scripts/version-and-commit.mjs`,
  and manual release operations. The example app has no separate Changesets flow.
- `scripts/validate-changeset.mjs` is the sole `getPrChanges` consumer; update
  parser and consumer together, including configurable JavaScript roots.
- `scripts/release-metadata.mjs` intentionally uses no-renames to attest individual
  metadata additions/modifications/deletions against an allowlist. It does not
  count PR fragments, so changing that comparison is unnecessary.
- Code-change detection selects CI jobs from paths rather than deciding whether
  fragments are new. Pending-fragment scanning and merging likewise have no
  PR-added-fragment comparison.
- The older issue-203 versioning experiment omitted Deno and formatter configs,
  yielding a false negative. Delegate it to the maintained regression fixture.
- Retain npm declaration checks and correct their explanation; contributing
  guidance records formatter pinning, dry-run behavior, and exact moves.
- Lint already runs independently of preflight after fresh-merge simulation.
  Its new PR-only step preserves the status gate and existing job timeout.

## CI evidence and reproducible validation

Original logs are preserved locally in `ci-logs/`:

- [Run 37294875650](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37294875650)
  started 2026-10-05T10:10:37Z at `4c8644fb457b65933fcb19b033e60e7d0338f2ad`.
  `release-37294875650.log:12096` identifies CLI 3.0.3, line 12098 reports
  `Error: spawn deno ENOENT`, and line 12104 reports the failed version bump.
- [Run 37558226002](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37558226002)
  started 2026-10-07T01:39:58Z at `1e43fdb4fb26d69376b8663674c170212eb01765`.
  `release-37558226002.log:152` and line 158 report the npm OIDC exchange 404.
  This earlier rejection prevents versioning from executing; PR dry-runs remove
  that blind spot. External trusted-publisher configuration remains an operator
  task, separate from the two requested code fixes.

Minimum reproductions use real processes in disposable fixtures:

```bash
node --test --test-timeout=30000 tests/changeset-config.test.js tests/pr-guards.test.js
node experiments/issue-203-changesets-version.mjs
node experiments/issue-216-release-dry-run.mjs
node experiments/issue-216-ci-fixtures.mjs
```

The release regression asserts Deno is unavailable, runs the actual CLI, and
checks patch version, fragment consumption, generated description, and Prettier
output. Guard tests use temporary Git repositories and the real guard script.
Fixtures are always removed; subprocess tests have finite budgets.

Full validation runs lint/format/duplication, all Node/Bun/Deno tests, syntax and
workflow-policy checks, the actual release wrapper dry-run, and hosted CI on the
pushed SHA. PR finalization verifies closing references, default-branch ancestry,
a clean tree, and preservation of existing behavior.

Local results: all 569 Node tests, all 569 Bun tests, and 417 Deno tests with
eight steps passed. Lint, Prettier, duplication, syntax, workflow policy, and
actionlint 1.7.12 with bundled shellcheck passed. The real PR versioning wrapper
succeeded without Deno in an isolated worktree, and its EXIT trap restored all
tracked metadata and consumed fragments. The worktree was removed afterward.
Runtime suites were run sequentially after observing that Deno's automatic
dependency installation rewrites the same node_modules directory used by Node
and Bun; hosted runtime jobs already use separate checkouts.

The first hosted run of these changes, [37634441807](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37634441807),
started 2026-10-07T14:10:06Z at `4941fd30913b036f95438df7631eccd304a737da`.
The real PR release dry-run passed, but new regression tests exposed two fixture
assumptions. Full logs are preserved as `checks-37634441807.log`:

- Lines 5606, 9176, and 11528 report Deno's missing
  `node_modules/@changesets/config/package.json`; clean Deno jobs install only
  used dependencies. Read its version from the release lockfile under Deno and
  continue verifying the installed version under Node/Bun.
- Lines 4425 and 11914 report Prettier rejecting the copied Windows manifest's
  CRLF line endings. Normalize the fixture manifest to match the Linux release
  runner, retaining generated-file checks on Windows.

`experiments/issue-216-ci-fixtures.mjs --expect-failure` reproduced both failures
before these test corrections, using separate worktrees with a CRLF manifest
and clean Deno dependency installation. Running the experiment without that flag
passes after the corrections; it also verifies fixture cleanup. No runtime jobs
are skipped, no timeout is increased, and production release behavior is unchanged.
