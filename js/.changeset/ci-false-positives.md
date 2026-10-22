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
