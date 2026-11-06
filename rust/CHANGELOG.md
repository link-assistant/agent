# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).













## [0.11.0] - 2026-11-06

### Fixed

- `edit` no longer replaces unrelated code through loose block-anchor
  matching, and an empty `oldString` no longer overwrites an existing file
  (synced from upstream OpenCode #30932, #335).
- `edit` keeps CRLF and mixed line endings and the UTF-8 BOM; `write` keeps
  the BOM (upstream #9443, #53166, #23797).
- `edit` no longer reports success without changing a CRLF file when only a
  whitespace-tolerant match was found.
- `edit` and `write` return a short confirmation instead of an empty output.
- `read` caps output at 50 KB and 2000 lines, reports directories, offsets
  past the end and non-regular files, finds file names with narrow no-break
  spaces or curly quotes, and samples only 4 KB for the binary check.
- `grep` searches hidden files and skips `.git`; `glob` stops at 100 results
  and says so.
- `bash` no longer deadlocks on large stderr output, keeps the end of long
  output without splitting UTF-8 characters (which panicked before), keeps
  partial output on timeout and reports the terminating signal.
- `webfetch`, `websearch` and `codesearch` stop reading bodies over 5 MB,
  retry Cloudflare challenges, accept plain JSON or SSE replies from Exa and
  pass `EXA_API_KEY` when set; `webfetch` defaults to markdown.

### Added

- Tool compatibility switches, each an environment variable with a
  matching CLI flag: `LINK_ASSISTANT_AGENT_BASH_SHELL` (`--bash-shell`),
  `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT` (`--legacy-tool-output`),
  `LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING` (`--legacy-edit-matching`),
  `LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS`, `LINK_ASSISTANT_AGENT_GREP_HIDDEN`,
  `LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS`, `LINK_ASSISTANT_AGENT_READ_MAX_LINES`,
  `LINK_ASSISTANT_AGENT_READ_MAX_BYTES`, `LINK_ASSISTANT_AGENT_READ_ONLY` and
  `LINK_ASSISTANT_AGENT_DISABLE_TOOLS` (#335). The legacy switches restore
  the behaviour of earlier releases where it differs from the JavaScript
  tools.
- `bash` metadata reports `timedOut`, `aborted` and `description`.

### Changed

- `edit` uses the JavaScript replacers: a block-anchor match picks the most
  similar block, a fuzzy match must be unique and much larger spans are
  refused; a UTF-8 BOM is kept out of matching; `metadata.diff` is the
  jsdiff `createTwoFilesPatch` output with common indentation removed and
  `filediff` keeps the file's own line endings; missing files, directories
  and an empty `filePath` give the JavaScript errors.
- `grep` without `output_mode` prints the JavaScript listing (matches
  grouped by file, newest first, at most 100), accepts `include`, honours
  `.gitignore`/`.ignore` and stops after the time limit.
- `glob` lists files like `rg --files`: absolute paths, newest first, at
  most 100, "No files found" when there are none.
- `list` uses the JavaScript ignore globs and `.gitignore`/`.ignore`.
- `read` splits lines and handles an empty file, a BOM, NFC file names and
  numeric-string parameters as JavaScript does, and streams the file.
- `bash` picks a POSIX shell from `$SHELL`, closes stdin and kills the whole
  process group on timeout.
- `webfetch` uses the JavaScript error messages.
- `todowrite` accepts the JavaScript todo schema.

### Fixed

- `permission` no longer panics on non-ASCII text before `&&` or `||`.
- The filesystem `contains` fallback compares whole path components.
- An empty given id generates a new id.
- `batch` reports every call past the limit of 10.
- `websearch` treats `numResults: 0` as 8 and validates `livecrawl`/`type`.
- `webfetch` skips `<script>`/`<style>` tags with attributes and keeps byte
  offsets valid in non-ASCII HTML during markdown conversion.

### Fixed

- The default model and default compaction model are now
  `kilo/nemotron-3-ultra-free`, and the default compaction cascade is
  `(kilo/nemotron-3-ultra-free kilo/nemotron-3.5-lightning-free same)`,
  because Kilo withdrew the former default `kilo/nemotron-3-super-free`
  (`nvidia/nemotron-3-super-120b-a12b:free`) (#335).

### Changed

- Updated `globset` to 0.4.21, `ignore` to 0.4.34, `similar` to 3.2.1 and
  `uuid` to 1.29.0 so the dependency-freshness check passes (#335).

## [0.10.6] - 2026-10-22

### Fixed

- Fix the clippy and rustdoc warnings the Rust pipeline let through: the
  pipeline now fails on any rustc, clippy, rustdoc or Cargo manifest warning
  (#337).
- Stop reporting a false `##[error]` on every crates.io release: trusted
  publishing now runs only when the `CRATES_IO_TRUSTED_PUBLISHING` repository
  variable is `true`, and the token fallback is announced with a notice (#337).
- Auto Release publishes the crate whenever the current version is missing
  from crates.io, even if its tag and GitHub release exist, and fails when
  crates.io cannot be reached instead of treating the version as unpublished
  (#337).
- The release tag is created after the release commit reaches main, so a push
  retried after a rebase no longer tags a commit that never landed (#337).

## [0.10.5] - 2026-10-22

### Changed

- Update tokio to 1.54.1 for the dependency freshness check.

### Security

- Update rustls-webpki to 0.103.16 (RUSTSEC-2026-0382) and webpki-root-certs to 1.0.10 (RUSTSEC-2026-0383).

## [0.10.4] - 2026-10-14

### Changed

- Publish to crates.io through GitHub Actions trusted publishing (OIDC), falling back to the `CARGO_REGISTRY_TOKEN` / `CARGO_TOKEN` secrets when trusted publishing is unavailable.

## [0.10.3] - 2026-10-12

### Fixed

- Align CLI default model and compaction cascade with the JavaScript implementation's served Kilo Nemotron models.

### Changed

- Update serde_json, tokio, and uuid to their current releases for the dependency freshness check.

## [0.10.2] - 2026-09-30

### Fixed

- Prefix failed shell command output with its exit status and expose `isError` while retaining exit metadata. Report timeouts as failed results with an unavailable exit status and terminate the dropped process.
- Count failed command results correctly in batch execution and propagate the batch error flag.

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

