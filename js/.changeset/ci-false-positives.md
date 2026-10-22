---
'@link-assistant/agent': patch
---

fix(ci): remove CI/CD false positives and false negatives (#337)

- The step budget wrapper (`scripts/run-with-budget-warning.sh`) no longer
  kills a command up to a second before its budget ends: bash's `SECONDS`
  counts second boundaries, so a 3s budget could expire after about 2s. This
  failed the JS unit tests on macOS and blocked the release of #334.
- The changeset check counts only the changesets a pull request adds, so an
  unreleased changeset from an earlier pull request no longer satisfies it.
- `agent generate` builds the agent configuration with `generateText` and
  `Output.object` instead of the deprecated `generateObject`, so it no longer
  prints an AI SDK `DeprecationWarning`. The AI SDK warning tests now capture
  warnings through `AI_SDK_LOG_WARNINGS`: AI SDK 7 reports them through
  `process.emitWarning`, which the old `console.warn` mock never saw.
- The `allowScripts` entry for `node-pty` matches the locked 1.1.0 instead of
  1.2.0-beta.15, and `js/.npmrc` sets `strict-allow-scripts` so a stale entry
  fails the install instead of logging a warning. CI installs on Node 26,
  which `@opentui/core` requires.
- Instant Release runs only after lint, the tests, the verbose integration
  test and the package install check pass, and every release job requires
  lint and test to succeed.
- A release rerun recognises that an earlier attempt already pushed its
  version commit when main moved meanwhile, instead of skipping the publish.
- The release pushes its version commit with up to three attempts, rebasing
  onto main when another merge landed first, instead of failing the release.
- The pipeline status gate fails on every unsuccessful job result, including
  a test that `timeout-minutes` cancelled on a pull request. A cancellation
  passes only when a newer run replaced this one and the job's own
  `cancel-in-progress` allowed that. Set `PIPELINE_STATUS_VERBOSE=1` to trace
  each decision. Every workflow now ends in such a gate.
- Model tests fail at once with the secret's name when `GROQ_API_KEY` is
  missing, and warn when Kilo models run without `KILO_API_KEY`.
- Refresh the AI SDK packages to their latest patch releases, which the
  Dependency Freshness check requires, and update `ip-address` to 10.7.4 for
  GHSA-rxp7-6hxx-x8q5.
