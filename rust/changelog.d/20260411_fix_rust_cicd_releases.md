---
bump: patch
---

### Fixed

- Fixed Rust CI/CD release pipeline that was silently skipping all releases (#247)
  - Added `always()` to `auto-release` and `manual-release` job conditions to prevent GitHub Actions from skipping them when the `changelog-check` job is skipped on push events
  - Fixed changelog version regex in `create-github-release.mjs` to support Rust's `## [version] - date` format alongside JS's `## version` format
  - Added `format-github-release.mjs` step to Rust release jobs for consistent release note formatting
