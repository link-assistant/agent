# Case Study: Issue #251 - Rust version should be published as link-assistant-agent

## Timeline

1. **Initial state**: Rust crate was named `agent` in `Cargo.toml` (since first Rust implementation)
2. **Issue #247 / PR #248**: Fixed CI/CD pipeline that was silently skipping all releases (merged as v0.8.0)
3. **Issue #251 filed**: Identified that the crate name `agent` conflicts with an existing crate on crates.io, CI/CD lacks actual publishing, and GitHub releases are created without actual crates.io publish

## Requirements from Issue

1. **Crate naming**: Rust package must be published as `link-assistant-agent` on crates.io
2. **License verification**: Ensure actual license matches before publishing
3. **Badge coverage**: Crates.io badges must be present in all relevant README files and GitHub releases
4. **False positive releases**: GitHub release must NOT be created before the crate is actually published to crates.io
5. **Case study**: Document findings in `docs/case-studies/issue-251/`

## Root Causes

### 1. Crate name conflict

- **Problem**: The crate was named `agent` in `Cargo.toml`, but this name is already taken on crates.io by another author (liangshuai, published 2025-11-19, version 0.0.1, "A flexible AI Agent SDK for building intelligent agents")
- **Root cause**: The crate name was chosen without checking crates.io availability
- **Impact**: The crate could never be published to crates.io under the name `agent`

### 2. Missing `cargo publish` step in CI/CD

- **Problem**: The Rust release workflow (`rust.yml`) had no `cargo publish` step at all
- **Root cause**: When the release pipeline was created, the crates.io publish step was never added. The JS pipeline (`js.yml`) correctly publishes to npm before creating a GitHub release, but this pattern was not replicated for Rust
- **Impact**: GitHub releases were created giving the appearance of a published crate, but the crate was never actually available on crates.io

### 3. False positive GitHub releases

- **Problem**: GitHub releases were created unconditionally (after build success), not gated on successful crates.io publish
- **Root cause**: The release steps had no dependency on a publish step (which didn't exist)
- **Impact**: Users seeing GitHub releases would expect the crate to be installable via `cargo install agent`, but it was not available
- **Comparison**: The JS pipeline correctly gates GitHub release creation on `steps.publish.outputs.published == 'true'`

### 4. Badge pointing to wrong crate

- **Problem**: The crates.io badge in `rust/README.md` pointed to `https://crates.io/crates/agent` (someone else's crate)
- **Root cause**: Badge was added assuming the crate would be published under the name `agent`
- **Impact**: Badge would show version information for a completely different crate

## Solutions Implemented

### 1. Renamed crate to `link-assistant-agent`

- Changed `name` in `[package]` section of `Cargo.toml` to `link-assistant-agent`
- Changed `name` in `[lib]` section to `link_assistant_agent` (Rust convention: underscores in lib names)
- Kept `[[bin]]` name as `agent` so users still get the `agent` binary when installing
- Updated all `use agent::` imports to `use link_assistant_agent::` in source and test files
- Updated integration test helpers to use `Command::cargo_bin("agent")` instead of `cargo_bin_cmd!()` macro (which defaults to package name)

### 2. Added `cargo publish` step to CI/CD

- Added "Publish to crates.io" step in both `auto-release` and `manual-release` jobs
- Uses `CARGO_REGISTRY_TOKEN` secret for authentication
- Step outputs `published=true` on success

### 3. Fixed release ordering

- GitHub release creation is now conditional on `steps.publish.outputs.published == 'true'`
- Release notes formatting is also gated on successful publish
- This matches the JS pipeline pattern exactly

### 4. Updated all badges and install commands

- `rust/README.md`: Badge now points to `link-assistant-agent` on crates.io
- `rust/README.md`: Install command updated to `cargo install link-assistant-agent`
- `README.md` (root): Install command updated in implementations table
- `README.md` (root): Added crates.io badge under Rust Implementation section

### 5. License verification

- `Cargo.toml` specifies `license = "Unlicense"`
- Root `LICENSE` file contains the full Unlicense text (public domain dedication)
- **Verified**: License is consistent and correct

## Required Setup for Repository Owner

Before the next release, the repository owner must:

1. **Create a crates.io API token**: Go to https://crates.io/settings/tokens and create a token with publish scope
2. **Add `CARGO_REGISTRY_TOKEN` secret**: In GitHub repository settings > Secrets and variables > Actions, add the token as `CARGO_REGISTRY_TOKEN`

## Comparison: JS vs Rust Release Pipeline

| Aspect | JavaScript (js.yml) | Rust (rust.yml) - After Fix |
|--------|--------------------|-----------------------------|
| Package registry | npm | crates.io |
| Publish step | `node scripts/publish-to-npm.mjs` | `cargo publish --verbose` |
| Auth mechanism | npm OIDC trusted publishing | `CARGO_REGISTRY_TOKEN` secret |
| Publish before release | Yes | Yes (fixed) |
| Release gated on publish | Yes (`steps.publish.outputs.published`) | Yes (fixed) |
| Changelog system | Changesets (`.changeset/`) | Fragments (`changelog.d/`) |

## Verification

- All tests pass after crate rename (`cargo test` - all passing)
- Formatting check passes (`cargo fmt --check`)
- Clippy passes (no new warnings introduced)
- Name `link-assistant-agent` is available on crates.io (verified via API - returns 404)
- Binary name remains `agent` for user convenience
