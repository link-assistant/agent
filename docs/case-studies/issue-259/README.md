# Case Study: Issue #259 — Version Bump for Rust CI/CD Not Working

## Summary

The Rust CI/CD auto-release pipeline was failing when merging PRs to main. Two distinct root causes were identified, both related to the concurrent execution of the Rust and JS release workflows.

## Timeline of Events

| Timestamp (UTC)       | Event                                                        |
|-----------------------|--------------------------------------------------------------|
| 2026-04-12 14:08      | PR #253 merged, Rust CI succeeds (v0.8.0 → v0.9.0)         |
| 2026-04-13 01:55      | Push to main (cb37cb7), Rust CI succeeds (v0.9.0 released)  |
| 2026-04-13 06:19      | PR #256 merge (33d1d8c), Rust CI **fails** — `CARGO_REGISTRY_TOKEN` not set |
| 2026-04-13 06:19      | JS CI runs concurrently, pushes v0.22.4 commit to main      |
| 2026-04-13 06:31      | Fix commit (f675128) adds CARGO_TOKEN fallback               |
| 2026-04-13 06:33      | PR CI passes on fix branch                                   |
| 2026-04-13 06:39      | PR #258 opened with the fix                                 |
| 2026-04-13 07:49      | PR #258 merge (53684c8), Rust CI **fails** — git push rejected (non-fast-forward) |
| 2026-04-13 07:49      | JS CI runs concurrently, pushes v0.22.5 commit to main      |

## Root Causes

### Root Cause 1: Git Push Race Condition (non-fast-forward rejection)

**Symptom:** `rust-version-and-commit.mjs` fails at `git push` with:
```
! [rejected] main -> main (non-fast-forward)
error: failed to push some refs to 'https://github.com/link-assistant/agent'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart.
```

**CI Run:** [24331934514](https://github.com/link-assistant/agent/actions/runs/24331934514) (2026-04-13 07:49 UTC)

**Root Cause:** When a PR is merged to main, both the Rust and JS CI workflows trigger concurrently (because changes touch `scripts/` which is in both workflow path filters). The JS release job pushes a version commit (e.g., `0.22.5`) to main first. When the Rust release job then tries to push its version commit, it's rejected because its local `main` is behind the remote.

**Contrast with JS:** The JS `version-and-commit.mjs` already handles this by fetching `origin/main` and rebasing before committing (lines 170-207). The Rust `rust-version-and-commit.mjs` did not have equivalent logic.

**Fix:**
1. Added `git fetch origin main` + rebase before starting in `rust-version-and-commit.mjs`
2. Added push retry loop (up to 3 attempts) with `git pull --rebase` on failure
3. Added shared `concurrency: { group: release-main }` across all Rust and JS release jobs to serialize pushes to main

### Root Cause 2: Missing CARGO_REGISTRY_TOKEN Secret

**Symptom:** `publish-to-crates.mjs` fails with:
```
Error: CARGO_REGISTRY_TOKEN environment variable is not set
Crate link-assistant-agent does not exist on crates.io yet (first publish)
```

**CI Run:** [24328743522](https://github.com/link-assistant/agent/actions/runs/24328743522) (2026-04-13 06:19 UTC)

**Root Cause:** The `CARGO_REGISTRY_TOKEN` secret was not configured in the repository settings. The workflow used `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}` which resolves to empty string when neither secret exists.

**Fix (previously applied in commit f675128):** Added `CARGO_TOKEN` as a fallback in both the workflow YAML and the publish script. The underlying issue (no secret configured) requires manual action in GitHub repository settings.

## Requirements from Issue

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Double check latest changes before publishing | Fixed — fetch/rebase added |
| 2 | Handle changesets properly, merge into single release | Already working via changelog fragment system |
| 3 | Update changelog | Already working via `rust-collect-changelog.mjs` |
| 4 | Update Cargo.toml | Already working via `rust-version-and-commit.mjs` |
| 5 | Compare with template best practices | Analyzed — see below |
| 6 | Download logs and create case study | This document |
| 7 | Report issues to related repos | See below |

## Comparison with Template Repository

Reference: [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)

### Features in Template Not Yet in This Repo

| Feature | Template | This Repo | Impact |
|---------|----------|-----------|--------|
| `detect-changes` job | Yes | No | Template only runs CI when relevant files change; this repo uses path filters instead (sufficient for monorepo) |
| `version-check` job | Yes | No | Template prevents accidental manual version bumps in PRs |
| Code coverage (cargo-llvm-cov) | Yes | No | Low priority — can be added later |
| Deploy docs to GitHub Pages | Yes | No | Low priority — useful when API docs exist |
| Pre-commit hooks (.pre-commit-config.yaml) | Yes | Uses .husky | Equivalent functionality |
| Push race condition handling | **No** | **Now Fixed** | Template has the same bug — reported as issue |

### Key Observation

The template's `version-and-commit.rs` also does a plain `git push` without pull/rebase (line 497), meaning it would fail the same way in a multi-workflow repository. This is acceptable for the template because it's single-workflow (only one release job can run), but it's a latent bug if the template is extended. An issue has been filed.

## Files Changed

- `scripts/rust-version-and-commit.mjs` — Added fetch/rebase before commit, push retry with pull --rebase
- `.github/workflows/rust.yml` — Added `concurrency: { group: release-main }` to auto-release and manual-release jobs
- `.github/workflows/js.yml` — Added `concurrency: { group: release-main }` to release and instant-release jobs

## CI Logs

- [rust-24331934514.log](./rust-24331934514.log) — Non-fast-forward push failure
- [rust-24328743522.log](./rust-24328743522.log) — CARGO_REGISTRY_TOKEN not set failure
