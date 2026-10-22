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
