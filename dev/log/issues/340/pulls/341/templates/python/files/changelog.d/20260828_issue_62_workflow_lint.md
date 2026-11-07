### Added

- Added a `Workflows` job that runs `actionlint` (via the Docker image, so
  `shellcheck` lints every `run:` block too) on any change under `.github/`.
  No workflow in the template validated its own workflow files before, which
  is why the defect below survived.

### Fixed

- Removed the unsupported `queue: max` key from the two write-capable
  `concurrency:` blocks in `release.yml`. GitHub Actions accepts only `group`
  and `cancel-in-progress`, so the key never had any effect and documented a
  queuing guarantee the workflow did not have. Behaviour is unchanged; a
  regression test now rejects unknown concurrency keys in every workflow.
- Quoted the `>> "$GITHUB_OUTPUT"` redirections and grouped the Docker publish
  config writes in `release.yml`, clearing every remaining `shellcheck`
  finding actionlint reports.
