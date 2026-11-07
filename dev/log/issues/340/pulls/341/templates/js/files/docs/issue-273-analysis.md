# Release and security evidence integrity

Issue [273](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/273)
collects nine defects found while applying the template downstream. The implementation
uses native JavaScript; no translation, carried behavior, native adapter, or Rust
CI change is introduced. Existing JavaScript-first readiness checks remain required.

## Requirement inventory and solution decisions

| Issue                                                                                           | Requirements, including follow-up comments                                                                                                                                                                                                                                                                                                              | Implementation and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [264](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/264) | Retry transient SDK transport failures, including DNS failures, for diagnostics and release-critical uploads. Bound retries; fail on exhaustion, missing/empty evidence, permanent authentication/4xx/quota errors. Reconcile artifacts finalized before a lost response. Preserve Pages compatibility and required failures.                           | The local artifact action uses the official SDK with three attempts and 5/10-second backoff. A retry deletes only the uniquely named artifact in the current run, tolerating confirmed absence, before re-uploading. Every maintained upload, Pages archive, and Docker digest download uses it. Transport tests inject recovery, exhaustion, permanent refusals, missing evidence and lost-finalization responses; filesystem tests inspect real empty directories and Pages tar contents. |
| [265](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/265) | Avoid the 300-file API diff limit without skipping either language or default queries. Set full-analysis mode for both init and analyze. Verify a hosted PR with over 300 changed files and no fallback warning.                                                                                                                                        | Job-wide `CODEQL_ACTION_DIFF_INFORMED_QUERIES=false` covers all CodeQL steps. Existing language matrix, configuration and queries remain. `experiments/issue-273-large-pr.mjs create` generates 301 temporary files for hosted verification; `remove` verifies ownership and exact content before cleanup. Both CodeQL languages completed full analysis on hosted revision `edc0abed` with 355 changed files and no fallback warning; the temporary files were then removed.               |
| [266](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/266) | Security must reject findings even when analyze/upload succeeds. Inspect every SARIF file, run and severity. Fail on missing, invalid or unsuccessful evidence. Preserve code scanning upload, query coverage, SARIF on failure and the aggregate gate. The downstream example had 50 findings.                                                         | Analyze writes `codeql-results`; the local gate rejects any result and malformed/missing reports or failed invocations. A subsequent uncancelled artifact step preserves reports even after rejection. CLI tests cover clean reports, all severities, later files/runs and invalid/tool-failure cases. No allowlist or severity exception is introduced.                                                                                                                                    |
| [267](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/267) | Missing, unreadable, empty and malformed lychee evidence must fail after a failed checker and never report all archived. Final failure must not depend on archive suggestions. Preserve the report as required evidence.                                                                                                                                | The archive CLI validates report structure and checker status, emits `all_archived=false` on errors and exits nonzero. Workflow final status still checks the original checker independently. Subprocess fixtures cover all unusable report states, including a directory instead of a readable file. Existing Wayback acceptance tests remain.                                                                                                                                             |
| [268](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/268) | The actual hook must use the root lint-staged configuration despite nested package/config files. Keep maintained checks and archive exclusions active. Explain the monorepo boundary.                                                                                                                                                                   | `.husky/pre-commit` passes `--config package.json`. An installed-CLI fixture uses the actual hook arguments, a nested exit-42 sentinel and a root maintained-file recorder. ESLint, Prettier and duplication checks exclude `dev/log`. This template intentionally has one root hook policy; a monorepo wanting package-owned tasks must explicitly configure root dispatch instead of depending on closest-config discovery.                                                               |
| [269](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/269) | Bun must discover only maintained tests, excluding archived and generated tests. Keep the timeout. Test the real configuration and distinguish archives in source-location rules.                                                                                                                                                                       | `bunfig.toml` sets `test.root='./tests'`. The fixture copies the real config and runs Bun against a maintained test plus throwing `dev/log` and `dist` sentinels. Existing CI timeouts remain; the location policy excludes generated/archive trees while still checking maintained sources.                                                                                                                                                                                                |
| [270](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/270) | Both release paths must preserve peers and every other non-version lock field in root/nested layouts. Support npm lock v2/v3, validate names/root metadata, use installed Changesets without resolution, reject configuration drift and rehearse offline in PR CI.                                                                                      | Shared capture/synchronization changes only the two root lock versions, validates package identity and checks graph/configuration invariants. Both release paths and the commit coordinator use the guard. Changesets uses `npx --no-install`; no lock regeneration remains. Real-script integration fixtures run offline in root and nested layouts; helper tests cover v2/v3 and invalid/drift states. The PR release rehearsal has offline mode enabled.                                 |
| [271](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/271) | Required formatting must fail for absent/refused/unavailable/malformed release data. Commit-to-PR lookup failures must stop before PATCH. Validate paginated arrays, accept only valid empty arrays as no PR, include every relevant PR (including page 31), deduplicate across commits, skip version PRs, preserve notes and support idempotent retry. | Both CLIs validate full release JSON. PR lookups use `gh api --paginate --slurp` and validate every page/item before writing. Offline command-stream fixtures exercise 401/403/404/429/5xx/network and malformed responses, no-write behavior, 31 PRs, deduplication, version filtering and repeat success.                                                                                                                                                                                 |
| [272](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/272) | Real heading selection and boundaries must ignore backtick/tilde fences, matching delimiter and length, and indented code. Preserve changelog body indentation and CRLF. Missing/empty entries fail; retain subsections. Commit-shaped example bullets and headings must never become metadata.                                                         | A shared offset-preserving Markdown scanner drives extraction, description sections, commit hashes, badge recognition and manual-version insertion. Tests cover both fence types, mismatched/short closing fences, exact versions, CRLF, trailing prose, indented examples and badges inside examples.                                                                                                                                                                                      |

## Existing components considered

The [official artifact SDK](https://github.com/actions/toolkit/tree/main/packages/artifact)
already supplies authenticated upload, listing, deletion and immutable-ID downloads.
The small wrapper adds transport retries around that complete operation; retrying
only an HTTP status misses DNS/socket failures. Glob and core also use official
Actions packages, pinned in a dedicated audited lockfile. Dependencies install with
lifecycle scripts disabled; the actual JavaScript action receives runner credentials.
Pages packaging follows the [official action's tar contract](https://github.com/actions/upload-pages-artifact/blob/v5/action.yml).
File symlinks follow the official uploader's discovery behavior, preserving
packaged application aliases. Link diagnostics retain optional recovered URLs,
but a separate required-file input prevents those from masking a missing report.

[Bun's test configuration](https://bun.com/docs/test/configuration) provides the
discovery root directly. [lint-staged's explicit configuration](https://github.com/lint-staged/lint-staged#configuration)
avoids its nearest-config search. These existing controls are preferable to shell
filters that leave alternate discovery paths active.

The [lychee Markdown formatter](https://github.com/lycheeverse/lychee/blob/lychee-v0.24.2/lychee-bin/src/formatters/stats/markdown.rs)
uses `# Summary` and separate errors/timeouts sections. Both fallback CLIs validate
its numeric summary before recovery; the older `# Link Checker Report` heading
remains supported. Timeout failures stay visible alongside ordinary errors.

The [CodeQL analyze action](https://github.com/github/codeql-action/blob/main/analyze/action.yml)
can retain local SARIF while performing its normal upload. A dependency-free gate
checks the complete reports; the existing terminal job checks its job outcome.
Full analysis uses CodeQL's documented feature environment convention in
[feature-flags.ts](https://github.com/github/codeql-action/blob/main/src/feature-flags.ts).

[npm lockfile documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)
defines the root metadata and dependency graph. Updating known metadata directly
avoids re-resolving a graph validated earlier in CI. The installed Changesets CLI
continues to own version selection and changelog generation.

[GitHub CLI pagination](https://cli.github.com/manual/gh_api) supplies all response
pages through `--paginate --slurp`. Treating failed lookups as empty lists would
silently produce incomplete release notes, so validation precedes every write.

[remark-parse](https://github.com/remarkjs/remark/tree/main/packages/remark-parse)
and mdast-util-from-markdown could supply a complete CommonMark syntax tree.
For Changesets' top-level headings and list entries, a small scanner preserves
original offsets and bytes without serializing an AST. Its fence rules follow
[CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).
It is intentionally not a general-purpose Markdown renderer. Nested blockquote
and list headings cannot match the top-level metadata patterns.

## Reproduction and validation

Run `node --test --test-concurrency=2 --test-timeout=30000 tests/*.test.js`,
`bun test --timeout 30000`, and `DENO_JOBS=2 deno test -A --parallel` after `npm ci`.
The tests named above exercise actual CLIs with finite local fixtures and mocked
GitHub/transport boundaries. Regression failures were recorded before implementing
the fixes. Investigation and command logs are retained locally in `ci-logs`.

Hosted evidence and final verification results are recorded in PR 274 and the
implementation plan. The temporary large-PR fixture was removed after all six same-revision workflow
results and logs were collected. Its reusable generator remains.

The first hosted JavaScript analysis demonstrated the gate against a real
finding: an unsafe hostname substring check in an executable historical formatter.
Its job failed and retained SARIF even though CodeQL analyze/upload succeeded.
That copy now shares the maintained formatter's exact URL predicate, with the
deceptive-host regression applied to both. No query or severity exception was used.
