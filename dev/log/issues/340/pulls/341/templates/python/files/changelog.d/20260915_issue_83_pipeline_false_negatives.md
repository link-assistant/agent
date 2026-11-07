### Fixed

- Classify cancelled workflow jobs against their effective
  `concurrency.cancel-in-progress` policy so timeouts cannot be mistaken for
  superseded runs.
- Prevent detached and privileged child processes from holding budgeted CI
  steps open after their command root exits or exceeds its deadline.
- Disable GitHub workflow-command parsing around contributor-authored release
  notes and captured command output.
