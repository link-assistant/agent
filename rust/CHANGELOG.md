# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.8.0] - 2026-04-12

### Added

- Separate CI/CD pipelines for JS and Rust code
- `rust.yml` workflow for Rust-specific builds, tests, and releases
- Changelog fragment system in `rust/changelog.d/` for tracking changes

### Added

- Added `--temperature` CLI option to override the temperature for model completions (#241)

### Fixed

- Fixed Rust CI/CD release pipeline that was silently skipping all releases (#247)
  - Added `always()` to `auto-release` and `manual-release` job conditions to prevent GitHub Actions from skipping them when the `changelog-check` job is skipped on push events
  - Fixed changelog version regex in `create-github-release.mjs` to support Rust's `## [version] - date` format alongside JS's `## version` format
  - Added `format-github-release.mjs` step to Rust release jobs for consistent release note formatting

