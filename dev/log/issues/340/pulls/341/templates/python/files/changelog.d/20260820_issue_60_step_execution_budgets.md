### Added

- Added `scripts/run-with-budget-warning.sh`, which runs a command under an
  execution budget that expires before the job clock: it warns at 70% of the
  budget, terminates the whole process group at the deadline, exits `124`, and
  emits an `::error` annotation naming the budget that was blown.

### Fixed

- Budgeted the long release steps (dependency installation, secret scanning,
  the test run and both Docker image builds) so an overrun reports `failure`
  with a named budget instead of the `cancelled` conclusion GitHub gives a job
  killed by `timeout-minutes` — which on a pull request produced no failure at
  all. `timeout-minutes` now serves only as a backstop, and a regression test
  keeps every step deadline at or below 70% of the cap it sits under.
