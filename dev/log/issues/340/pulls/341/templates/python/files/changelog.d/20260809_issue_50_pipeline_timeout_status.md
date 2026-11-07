### Fixed

- Added a terminal CI/CD status gate so failed jobs always fail the aggregate
  check, while cancelled jobs fail pushes to `main` instead of allowing job
  timeouts to look like benign workflow cancellations.
