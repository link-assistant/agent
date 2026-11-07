### Fixed

- Require source-changing pull requests to include a changelog fragment.

### Security

- Pass the pull request base branch to the changelog check as quoted data instead
  of interpolating it into the shell script.
