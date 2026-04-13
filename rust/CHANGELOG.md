# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).




## [0.9.1] - 2026-04-13

### Fixed

- Fixed false positive success on Rust package publishing (#255)
  - Added `publish-to-crates.mjs` script with retry logic and post-publish verification against the crates.io API
  - CI now verifies the crate actually appeared on crates.io before creating a GitHub release
  - Uses `--allow-dirty` flag to prevent `Cargo.lock` false failures during publishing

## [0.9.0] - 2026-04-12

### Changed

- Renamed crate from `agent` to `link-assistant-agent` on crates.io to avoid name conflict with existing `agent` crate
- Binary name remains `agent` for user convenience (`cargo install link-assistant-agent` installs the `agent` binary)

### Fixed

- CI/CD pipeline now publishes to crates.io before creating GitHub releases, preventing false positive releases
- GitHub release is only created after successful crates.io publish (matching the JS pipeline behavior)

### Added

- Crates.io badge added to root README under Rust Implementation section

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

