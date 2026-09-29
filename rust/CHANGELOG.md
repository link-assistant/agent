# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).







## [0.10.1] - 2026-09-29

### Changed

- Update all direct Rust dependencies to their latest releases and adapt identifier generation to rand 0.10.

## [0.10.0] - 2026-07-31

### Fixed

- CI/CD: Add recovery mechanism for missing GitHub releases when crate is already published on crates.io
- CI/CD: Improve crates.io publish verification with longer delays (20s) and more retries (5 attempts)
- CI/CD: Check crates.io API before retry attempts to detect successful prior publishes

### Changed

- Set the Rust CLI default model to `opencode/minimax-m2.5-free` to match the JavaScript implementation.

### Changed

- Move Rust integration tests from `tests/integration_*.rs` flat files into a `tests/integration/` subdirectory, mirroring the JS `js/tests/integration/` structure. Added `[[test]]` entries in `Cargo.toml` so each test file remains its own named binary (`integration_basic`, `integration_verbose_hi`, etc.). Added `tests/integration/_defaults.rs` helper mirroring `js/tests/integration/_defaults.js` for centralized default-model access.

### Added

- Added Rust CLI option parity for `--input-format stream-json` and `--output-format stream-json`.

### Added

- Added a `permission` module mirroring the JavaScript permission system (issue #271): `Mode` (`auto`/`plan`/`readonly`/`ask`), `Action` (`allow`/`ask`/`deny`), `Policy`, mode/override resolution, the read-only shell allowlist, structured bash evaluation, and the `permission_request` / `permission_response` JSON schemas.
- Added `--permission-mode` (env `LINK_ASSISTANT_AGENT_PERMISSION_MODE`) and `--permission` (env `LINK_ASSISTANT_AGENT_PERMISSION`) CLI flags. The default mode is `auto`, so behavior is unchanged. Invalid modes or `--permission` JSON now fail fast with a clear error.

### Fixed

- Fixed the Rust release workflow crate lookup, which exited with code 3 when the crate name grep found no match, and removed the false-positive classification of `cargo publish` failures.
- Hardened the Rust version bump, tag and push steps, and added least-privilege permissions, concurrency groups and per-job timeouts to `rust.yml`.

## [0.9.2] - 2026-04-13

### Fixed

- Use `CARGO_TOKEN` (organization-level secret) as fallback when `CARGO_REGISTRY_TOKEN` is not set, fixing crates.io publishing in CI/CD

### Fixed

- Fixed git push race condition in Rust CI/CD auto-release that caused non-fast-forward rejection when JS CI pushed concurrently
- Added fetch/rebase before commit and push retry with pull --rebase (up to 3 attempts)
- Added shared concurrency group (`release-main`) across Rust and JS release jobs to serialize pushes to main

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

