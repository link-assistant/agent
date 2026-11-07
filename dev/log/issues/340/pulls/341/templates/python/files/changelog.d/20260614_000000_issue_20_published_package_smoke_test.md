### Fixed

- Release jobs now install the just-published PyPI package into a clean virtual
  environment and smoke-test imports and declared console scripts before
  creating the GitHub release. Console-script output is captured before preview
  lines are printed, avoiding SIGPIPE-sensitive live pipelines such as
  `command | head`.
