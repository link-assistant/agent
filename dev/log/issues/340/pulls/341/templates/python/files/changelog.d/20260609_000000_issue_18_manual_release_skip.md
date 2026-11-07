### Fixed

- Manual `workflow_dispatch` releases no longer get silently skipped. The
  `lint`, `test`, and `manual-release` jobs now use `always() && !cancelled()`
  status-check functions so the intentionally skipped `detect-changes` job does
  not propagate through `needs` and skip the release path. `manual-release` also
  explicitly requires `lint`, `test`, and `build` to succeed before releasing.
