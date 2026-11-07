### Added

- Validate pull requests with a fresh base-branch merge, a secrets scan, and a
  cached Docker image build when a Dockerfile is present.

### Fixed

- Propagate workflow cancellation through dependent CI and release jobs instead
  of combining contradictory `always()` and `!cancelled()` guards.
