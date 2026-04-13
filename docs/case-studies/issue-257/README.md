# Case Study: CARGO_REGISTRY_TOKEN Not Set — Use CARGO_TOKEN as Fallback (Issue #257)

## Summary

The Rust CI/CD publish step fails because `CARGO_REGISTRY_TOKEN` secret is not configured at the repository level. The organization has `CARGO_TOKEN` set at the organization level, which should be used as a fallback.

## Timeline

| Time (UTC) | Event | Run ID | Details |
|---|---|---|---|
| 2026-04-12 12:49 | Push to main | 24307135603 | Auto Release failed — `Cargo.lock` uncommitted (separate issue, fixed in #255) |
| 2026-04-13 01:55 | Push to main | 24322104554 | Auto Release skipped — `rust-v0.9.0` tag already exists, no new fragments |
| 2026-04-13 06:19 | Push to main (merge #256) | 24328743522 | Auto Release failed — `CARGO_REGISTRY_TOKEN` is empty |

## Root Cause

### `CARGO_REGISTRY_TOKEN` secret is not set at the repository level

The workflow passes `secrets.CARGO_REGISTRY_TOKEN` to the publish step:

```yaml
- name: Publish to crates.io
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
  run: node scripts/publish-to-crates.mjs --should-pull
```

The CI logs confirm the token is empty:

```
Auto Release  Publish to crates.io  env:
Auto Release  Publish to crates.io    CARGO_REGISTRY_TOKEN: 
```

The publish script (`scripts/publish-to-crates.mjs`) detects this and exits:

```
Error: CARGO_REGISTRY_TOKEN environment variable is not set
##[error]Process completed with exit code 1.
```

The organization has a `CARGO_TOKEN` secret set at the organization level that can be used as a fallback.

### Why `CARGO_REGISTRY_TOKEN` is the expected variable name

Cargo natively reads `CARGO_REGISTRY_TOKEN` to authenticate with crates.io. The `cargo publish` command uses this environment variable automatically. However, organizations may use different naming conventions for their secrets (e.g., `CARGO_TOKEN`). The fix needs to bridge this gap.

## Affected Components

1. **`.github/workflows/rust.yml`** — Both `auto-release` and `manual-release` jobs pass `CARGO_REGISTRY_TOKEN` to the publish step
2. **`scripts/publish-to-crates.mjs`** — Checks only `CARGO_REGISTRY_TOKEN` environment variable

## Solution

### Fix 1: Workflow — Use `CARGO_TOKEN` as fallback in env

In both `auto-release` and `manual-release` jobs, set `CARGO_REGISTRY_TOKEN` from `CARGO_TOKEN` when `CARGO_REGISTRY_TOKEN` is not available:

```yaml
env:
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
```

This uses GitHub Actions' expression fallback: if `CARGO_REGISTRY_TOKEN` is empty/unset, it falls back to `CARGO_TOKEN`.

### Fix 2: Script — Add fallback logic in publish script

The `publish-to-crates.mjs` script should also resolve the token with fallback, so it works correctly regardless of how it's invoked:

```javascript
const token = process.env.CARGO_REGISTRY_TOKEN || process.env.CARGO_TOKEN;
if (!token) {
  console.error('Error: Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN environment variable is set');
  process.exit(1);
}
process.env.CARGO_REGISTRY_TOKEN = token;
```

## Verification

After the fix, the publish step should:
1. Resolve the token from either `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN`
2. Set `CARGO_REGISTRY_TOKEN` so `cargo publish` can use it natively
3. Log which source the token came from (without revealing the token value)

## Lessons Learned

1. **Use fallback secrets for organization-level tokens**: When a secret may be set at different levels (repo vs org), use the `||` operator in GitHub Actions expressions to provide fallback.
2. **Script-level fallback is defense-in-depth**: Even though the workflow sets the env var, the script should also handle fallback to be robust when run locally or from other contexts.
3. **Log token source, not value**: When debugging auth issues, knowing *which* secret was used helps without exposing credentials.
