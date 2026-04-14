# Case Study: Issue #261 - Rust CI/CD Missing Releases

## Summary

Version 0.9.2 of `link-assistant-agent` was published to crates.io but no GitHub release was created. The root cause was a chain of failures in the CI/CD pipeline related to crates.io propagation delays and missing recovery logic.

## Timeline

| Time (UTC) | Event | CI Run | Result |
|---|---|---|---|
| 2026-04-13 06:19 | Push to main (v0.9.0 -> 0.9.1 bump) | [24328743522](https://github.com/link-assistant/agent/actions/runs/24328743522) | **Failed**: `CARGO_REGISTRY_TOKEN` not set |
| 2026-04-13 07:49 | Push to main (CARGO_TOKEN fallback fix) | [24331934514](https://github.com/link-assistant/agent/actions/runs/24331934514) | **Failed**: crates.io publish verification failed (5s too short) |
| 2026-04-13 08:51 | Push to main (propagation delay fix) | [24334488286](https://github.com/link-assistant/agent/actions/runs/24334488286) | **Failed**: v0.9.2 published but old code ran (fix not yet merged) |
| 2026-04-13 10:14 | PR #262 merged (all fixes) | [24337999712](https://github.com/link-assistant/agent/actions/runs/24337999712) | **Success** but no release: fragments consumed, tag exists, skipped |

## Root Cause Analysis

### Root Cause 1: Missing CARGO_REGISTRY_TOKEN (run 24328743522)

The workflow used `${{ secrets.CARGO_REGISTRY_TOKEN }}` but the organization had the token stored as `CARGO_TOKEN`. The script checked for `CARGO_REGISTRY_TOKEN` only.

**Fix applied in PR #258**: Added `CARGO_TOKEN` as fallback in `publish-to-crates.mjs`.

### Root Cause 2: Insufficient crates.io propagation delay (run 24331934514)

After a successful `cargo publish`, the script waited only 5 seconds to verify on the crates.io API. First-time publishes can take 15-30+ seconds to propagate.

**Fix applied in PR #260**: Increased verification delay and added retry logic.

### Root Cause 3: "Already exists" not treated as success (run 24334488286)

After the first publish attempt succeeded (exit code 0) but verification failed, retry attempts received "crate already exists" error (exit code 101). The old code treated this as a failure instead of recognizing that the crate was already published.

**Fix applied in PR #262**: Added `detectAlreadyExists()` logic to treat "already exists" as success.

### Root Cause 4: No recovery for missing GitHub releases (run 24337999712)

When the fix merged, the changelog fragments had been consumed by previous runs and the git tag `rust-v0.9.2` already existed. The check logic only looked at git tags:

```yaml
if git rev-parse "rust-v$CURRENT_VERSION" >/dev/null 2>&1; then
  echo "should_release=false"  # <- Skips GitHub release creation too!
fi
```

This meant the GitHub release was never created despite the crate being published on crates.io.

**Fix applied in this PR (#263)**:
- Check crates.io API, GitHub release existence, AND git tags
- If tag exists but GitHub release doesn't, proceed with release creation
- Use crates.io as the authoritative source of truth for publish status

## Requirements from Issue

1. **Crates.io release**: Published (v0.9.2) but via a failed CI run
2. **GitHub release with badge**: Missing - never created
3. **Check already-published versions**: If version is already on crates.io, treat as success
4. **Check GitHub release existence**: Create if missing even when tag exists
5. **Case study documentation**: This document

## Key Learnings

1. **Use crates.io API as source of truth** - Git tags can exist without successful crates.io publish, and vice versa. Always check the actual registry.
2. **Recovery mechanisms are essential** - CI/CD pipelines must handle partial failures gracefully. If step N fails but step N-1 succeeded, the next run should detect and continue from where it left off.
3. **Verification delays must account for worst-case propagation** - First-time crate publishes can take 30+ seconds to appear on the crates.io API. Use generous delays with multiple retries.
4. **"Already exists" is not an error** - When a registry says "already exists," that's a success signal, not a failure.

## Files Changed

- `.github/workflows/rust.yml` - Added crates.io + GitHub release checks in release decision logic
- `scripts/publish-to-crates.mjs` - Added pre-retry crates.io API check, increased propagation delay/retries

## References

- [Issue #261](https://github.com/link-assistant/agent/issues/261)
- [PR #263](https://github.com/link-assistant/agent/pull/263)
- [Reference: rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template) - Uses crates.io as source of truth for release decisions
