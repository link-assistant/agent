# Case Study: False Positive Success on Rust Package Publishing (Issue #255)

## Summary

CI/CD pipeline reported success for Rust package releases, but the crate was never actually published to crates.io. A GitHub release and git tag were created, giving the false appearance of a successful release.

## Timeline

| Time (UTC) | Event | Commit | Details |
|---|---|---|---|
| 2026-04-12 11:53 | Push to main | `b1d0d1d` | Triggered Rust CI/CD Pipeline (run 24306117175) |
| 2026-04-12 11:55 | Auto Release: bump to 0.8.0 | `a258ba4` | Version bumped from 0.7.0 to 0.8.0 |
| 2026-04-12 11:56 | GitHub Release created | — | `[rust] 0.8.0` release created, tag `rust-v0.8.0` pushed |
| 2026-04-12 11:56 | **CI reports SUCCESS** | — | Overall job conclusion: success |
| 2026-04-12 12:49 | Push to main | `62978b1` | Merge PR #252 (rename crate + fix publishing) |
| 2026-04-12 12:51 | Auto Release: bump to 0.9.0 | — | Version bumped, tag `rust-v0.9.0` created |
| 2026-04-12 12:52 | `cargo publish` fails | — | `Cargo.lock` has uncommitted changes |
| 2026-04-12 12:52 | **CI reports FAILURE** | — | Job conclusion: failure |
| 2026-04-13 01:55 | Push to main | `cb37cb7` | Triggered Rust CI/CD Pipeline (run 24322104554) |
| 2026-04-13 01:57 | Auto Release: no fragments | — | `rust-v0.9.0` already released (tag exists) |
| 2026-04-13 01:57 | **CI reports SUCCESS** | — | Job skipped release, reported success |

## Root Causes

### Root Cause 1: Missing `cargo publish` Step (v0.8.0)

**At commit `b1d0d1d`**, the `auto-release` job in `.github/workflows/rust.yml` had **no `cargo publish` step**. The workflow went directly from `cargo build --release` to `Create GitHub Release`:

```yaml
# What the workflow had at commit b1d0d1d:
- name: Build release
  run: cargo build --release
  working-directory: rust

- name: Create GitHub Release        # ← No cargo publish before this!
  if: steps.check.outputs.should_release == 'true'
  run: node scripts/create-github-release.mjs ...
```

**Impact**: A GitHub release `[rust] 0.8.0` was created with a tag, but the crate was never published to crates.io. The crate `agent` (the package name at the time) is owned by a different user on crates.io (`liangshuai`), so even if `cargo publish` had run, it would have failed with a permission error.

### Root Cause 2: `Cargo.lock` Uncommitted After Version Bump (v0.9.0)

**At commit `62978b1`**, the `cargo publish` step was added, but it failed with:

```
error: 1 files in the working directory contain changes that were not yet committed into git:

Cargo.lock

to proceed despite this and include the uncommitted changes, pass the `--allow-dirty` flag
```

The `rust-version-and-commit.mjs` script runs `cargo generate-lockfile` and stages `Cargo.lock` for the commit. However, the subsequent `cargo build --release` step in the workflow modifies `Cargo.lock` again, leaving it dirty when `cargo publish` runs.

This happens because `cargo generate-lockfile --manifest-path rust/Cargo.toml` and `cargo build --release` (run with `working-directory: rust`) may produce different lockfile content — particularly when the package name changes (from `agent` to `link-assistant-agent` in this case).

### Root Cause 3: No Post-Publish Verification

Even in the current workflow (which does have `cargo publish`), there is no verification that the crate actually appeared on crates.io after publishing. `cargo publish` could return exit code 0 in edge cases without the crate being available.

## Verification

### Crate not on crates.io

```bash
$ curl https://crates.io/api/v1/crates/link-assistant-agent
# Returns 404 — crate was never published

$ curl https://crates.io/api/v1/crates/agent
# Returns 200 — owned by user liangshuai (different owner)
```

### GitHub release exists but is misleading

```bash
$ gh release list --repo link-assistant/agent | grep rust
[rust] 0.8.0    rust-v0.8.0    2026-04-12T11:56:17Z
```

## Evidence from CI Logs

### Run 24306117175 (v0.8.0 release — false positive)

The `##[group]Run` commands in the Auto Release job show the complete step sequence:

1. `git config user.name` → configure git
2. `node scripts/rust-get-bump-type.mjs` → found 3 fragments, bump type: minor
3. Check for changelog fragments → `should_release=true`
4. `node scripts/rust-version-and-commit.mjs --bump-type minor` → bumped to 0.8.0
5. `grep -Po ... rust/Cargo.toml` → get current version
6. `cargo build --release` → compiled `agent v0.8.0`
7. **No `cargo publish` step** → skipped entirely
8. `node scripts/create-github-release.mjs` → created GitHub release
9. `node scripts/format-github-release.mjs` → formatted release notes

### Run 24307135603 (v0.9.0 — correctly reported failure)

```
Auto Release  Publish to crates.io  error: 1 files in the working directory contain changes
                                     that were not yet committed into git:
                                     Cargo.lock
Auto Release  Publish to crates.io  ##[error]Process completed with exit code 101.
```

## Solutions Implemented

### Fix 1: Add `--allow-dirty` flag and verify publish

The `cargo publish` step now uses `--allow-dirty` to avoid the `Cargo.lock` issue, but adds post-publish verification to ensure the crate actually appeared on crates.io.

### Fix 2: Post-publish verification

After `cargo publish`, the workflow verifies the crate exists on crates.io by querying the API. If the crate is not found, the step fails explicitly.

### Fix 3: Explicit failure on publish skip

The workflow now explicitly checks whether `cargo publish` ran and succeeded before proceeding to create a GitHub release. If the publish step was skipped or failed, the job fails with a clear error message.

## Lessons Learned

1. **Always verify the end-to-end result**: A build succeeding is not the same as a publish succeeding. Post-publish verification (checking the registry) catches silent failures.
2. **Guard downstream steps on upstream outputs**: The GitHub release creation should have been gated on a `published=true` output from the publish step, not just on `should_release`.
3. **Test the release pipeline itself**: The release pipeline was never tested end-to-end before the first real release attempt.
4. **Don't trust exit codes alone**: Even with `set -e`, a step can be skipped entirely if its condition isn't met, and downstream steps may still run if they have their own independent conditions.
