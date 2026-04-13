# Case Study: Issue #261 - Rust CI/CD Pipeline Failure (No Crates Release, No GitHub Release)

## Summary

The Rust CI/CD auto-release pipeline successfully published crate `link-assistant-agent@0.9.2` to crates.io but then failed verification due to crates.io propagation delay. This caused the pipeline to exit with error, preventing GitHub Release creation.

## Timeline of Events

**CI Run:** [#24334488286](https://github.com/link-assistant/agent/actions/runs/24334488286/job/71048047065)
**Date:** 2026-04-13

| Time (UTC) | Event |
|---|---|
| 08:54:25 | Auto Release job starts |
| 08:54:32 | Detects 2 changelog fragments (patch bump) |
| 08:54:34 | Bumps version to 0.9.2, commits and tags `rust-v0.9.2` |
| 08:54:35 | Pushes changes and tags to origin |
| 08:55:42 | `publish-to-crates.mjs` starts, detects crate doesn't exist yet on crates.io |
| 08:55:42 | Publish attempt 1 starts (`cargo publish`) |
| 08:56:19 | `cargo publish` succeeds (exit code 0), waits 5s for propagation |
| 08:56:24 | Verification fails - crate not found on crates.io API yet (propagation delay) |
| 08:56:24 | Script treats verification failure as publish failure, waits 10s |
| 08:56:34 | Publish attempt 2 - gets `error: crate link-assistant-agent@0.9.2 already exists on crates.io index` |
| 08:56:34 | Script matches `error: ` failure pattern, doesn't recognize "already exists" as success |
| 08:56:44 | Publish attempt 3 - same "already exists" error |
| 08:56:44 | Script exits with code 1, `published=false` |
| 08:56:44 | GitHub Release step skipped (gated on `published == 'true'`) |

## Root Causes

### Root Cause 1: Insufficient crates.io propagation wait time
- Script waited only 5 seconds for crates.io API propagation
- The crate was actually published but the API hadn't updated yet
- crates.io can take 10-30+ seconds to propagate depending on load

### Root Cause 2: "already exists" error not recognized as success
- On retry, `cargo publish` returns: `error: crate link-assistant-agent@0.9.2 already exists on crates.io index`
- The `detectPublishFailure()` function matched `error: ` pattern first
- The `crate already uploaded` pattern didn't match this different error wording
- The script had no concept of "already exists on index" being a success case

### Root Cause 3: No verification retries
- Verification was a single check after a fixed 5s delay
- No retry mechanism for verification (only for the publish command itself)

### Root Cause 4: GitHub Release gated solely on publish output
- Workflow condition `steps.publish.outputs.published == 'true'` meant any publish failure blocked GitHub Release
- Even when the crate WAS published, the script exited with error so the output was `false`

### Root Cause 5: No graceful handling of existing GitHub releases
- `create-github-release.mjs` would fail fatally if the release tag already existed
- No recovery path for re-running the pipeline

## Solutions Applied

### Fix 1: Recognize "already exists" as successful publish
- Added `ALREADY_EXISTS_PATTERNS` array with common crates.io "already exists" messages
- `detectAlreadyExists()` checks these patterns before `detectPublishFailure()`
- When detected, script sets `published=true` and `already_published=true`

### Fix 2: Improved verification with retries
- Increased initial propagation delay from 5s to 15s
- Added verification retry loop (3 attempts with 10s between retries)
- If cargo publish exits with code 0 but verification can't confirm, treats as success (trusting cargo's exit code)

### Fix 3: Graceful GitHub Release creation
- `create-github-release.mjs` now catches "already exists" / "Validation Failed" errors
- Skips creation silently instead of failing

### Fix 4: Decoupled workflow conditions
- GitHub Release step now runs if `should_release == 'true'` AND either `published == 'true'` OR `publish.outcome == 'success'`
- This ensures GitHub Release is created even in edge cases

## Best Practices Applied (from reference repos)

Referenced from:
- [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)
- [mem-rs](https://github.com/linksplatform/mem-rs)

1. **Treat crates.io as authoritative source** - check actual API, not just git tags
2. **"Already exists" is success** - following mem-rs graceful pattern
3. **Trust cargo exit code** - if `cargo publish` exits 0, the publish succeeded even if API is slow
4. **Idempotent release creation** - GitHub Release creation handles "already exists" gracefully
5. **Verification with backoff** - multiple verification attempts with increasing delays
