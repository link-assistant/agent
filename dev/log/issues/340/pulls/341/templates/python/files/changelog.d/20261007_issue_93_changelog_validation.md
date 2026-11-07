### Fixed

- Enforce newly added changelog fragments for source changes using a verified
  Git merge base, fail when refs or history are unavailable, and validate the
  fragment contents committed in the pull request.
- Use the same changelog validator locally and in CI while preserving
  documentation, example, and experiment exemptions in both Python layouts.
