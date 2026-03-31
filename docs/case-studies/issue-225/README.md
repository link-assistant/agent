# Case Study: Update CI/CD to Use Latest Actions and Node 24 (Issue #225)

## Summary

GitHub Actions CI/CD workflows in this repository were using deprecated Node.js 20-based actions (`actions/checkout@v4`, `actions/setup-node@v4`) and Node.js version `20.x`. GitHub has announced that Node.js 20 actions will be deprecated and forced onto Node.js 24 by default starting June 2, 2026, with Node.js 20 removed from runners entirely on September 16, 2026.

**Fix:** Updated all 4 workflow files to use `actions/checkout@v6`, `actions/setup-node@v6`, and `node-version: '24.x'`.

## Root Cause Analysis

### Root Cause: Pinned Action Versions and Node.js Version

The repository's workflows were pinned to `actions/checkout@v4` and `actions/setup-node@v4`, which internally run on Node.js 20. GitHub has released v5 and v6 of both actions, which use Node.js 24.

**Affected workflows and jobs:**

| Workflow | Jobs | Actions Updated |
|----------|------|-----------------|
| `js.yml` | changeset-check, lint, test, verbose-integration, release, instant-release, changeset-pr | `checkout@v4→v6`, `setup-node@v4→v6` (node 20→24) |
| `rust.yml` | changelog-check, lint, test, build, auto-release, manual-release | `checkout@v4→v6`, `setup-node@v4→v6` (node 20→24) |
| `integration-tests.yml` | test-single, test-all | `checkout@v4→v6` |
| `model-tests.yml` | test-model | `checkout@v4→v6` |

**Deprecation warnings from GitHub (6 warnings across CI runs):**
```
Node.js 20 actions are deprecated. The following actions are running on Node.js 20
and may not work as expected: actions/checkout@v4, actions/setup-node@v4
Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026.
Node.js 20 will be removed from the runner on September 16th, 2026.
```

### Why v6 and not v5?

- `actions/checkout@v6` is the latest release (v6.0.2 as of 2026-03-31)
- `actions/setup-node@v6` is the latest release (v6.3.0 as of 2026-03-31)
- Jumping directly to latest avoids needing another update in the near future

### Node.js 24.x compatibility

The scripts in this repo (`scripts/*.mjs`) use standard Node.js APIs that are fully compatible with Node.js 24. No code changes were required — only the CI configuration needed updating.

## Changes Made

**File: `.github/workflows/js.yml`**
- 7 occurrences of `actions/checkout@v4` → `actions/checkout@v6`
- 5 occurrences of `actions/setup-node@v4` → `actions/setup-node@v6`
- 5 occurrences of `node-version: '20.x'` → `node-version: '24.x'`

**File: `.github/workflows/rust.yml`**
- 6 occurrences of `actions/checkout@v4` → `actions/checkout@v6`
- 3 occurrences of `actions/setup-node@v4` → `actions/setup-node@v6`
- 3 occurrences of `node-version: '20.x'` → `node-version: '24.x'`

**File: `.github/workflows/integration-tests.yml`**
- 2 occurrences of `actions/checkout@v4` → `actions/checkout@v6`

**File: `.github/workflows/model-tests.yml`**
- 1 occurrence of `actions/checkout@v4` → `actions/checkout@v6`

## References

- [actions/checkout releases](https://github.com/actions/checkout/releases) — v6.0.2 is latest
- [actions/setup-node releases](https://github.com/actions/setup-node/releases) — v6.3.0 is latest
- [GitHub blog: Node.js 20 deprecation in actions](https://github.blog/changelog/2025-05-07-github-actions-node-js-20-deprecation/)
- Issue #225: https://github.com/link-assistant/agent/issues/225
- Pull Request #226: https://github.com/link-assistant/agent/pull/226
