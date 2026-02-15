# Case Study: Issue #186 - Incorrect Peer Dependency Warnings

## Summary

When installing `@link-assistant/agent@0.16.0` using Bun, users see the following warnings:

```
$ bun install -g @link-assistant/agent
bun add v1.3.8 (b64edcb4)
warn: incorrect peer dependency "ai@6.0.86"
warn: incorrect peer dependency "solid-js@1.9.11"
installed @link-assistant/agent@0.16.0 with binaries:
 - agent
```

## Root Cause Analysis

### Problem 1: `ai@6.0.86` Peer Dependency Warning

**Root Cause**: `@openrouter/ai-sdk-provider@1.5.4` (used by `@link-assistant/agent`) has peer dependency `ai@^5.0.0`, but `@link-assistant/agent` uses `ai@^6.0.1` (resolved to `ai@6.0.86`).

The mismatch occurs because:
1. `@link-assistant/agent` upgraded to AI SDK v6 on February 12, 2026 (commit `5ce1b0a`)
2. `@openrouter/ai-sdk-provider` added AI SDK v6 support in version 2.0.0 (released January 19, 2026)
3. When bundling AI SDK providers on February 15, 2026 (commit `71ca1da`), version `^1.5.4` was specified, which doesn't support AI SDK v6

**Dependency Chain**:
```
@link-assistant/agent@0.16.0
├── ai@^6.0.1 (resolves to 6.0.86)
└── @openrouter/ai-sdk-provider@^1.5.4
    └── peerDependencies: { ai: "^5.0.0" }  ← CONFLICT
```

### Problem 2: `solid-js@1.9.11` Peer Dependency Warning

**Root Cause**: `@opentui/solid@0.1.46` has peer dependency `solid-js@1.9.9` (exact version), but `@link-assistant/agent` uses `solid-js@^1.9.10` (resolved to `1.9.11`).

**Dependency Chain**:
```
@link-assistant/agent@0.16.0
├── solid-js@^1.9.10 (resolves to 1.9.11)
└── @opentui/solid@^0.1.46
    └── peerDependencies: { solid-js: "1.9.9" }  ← CONFLICT (exact version)
```

## Timeline of Events

| Date | Event |
|------|-------|
| 2026-01-19 | `@openrouter/ai-sdk-provider@2.0.0` released with AI SDK v6 support |
| 2026-02-12 | `@link-assistant/agent` upgraded to `ai@^6.0.1` (commit `5ce1b0a`) |
| 2026-02-15 | `@openrouter/ai-sdk-provider@^1.5.4` added as bundled dependency (commit `71ca1da`) |
| 2026-02-15 | `@link-assistant/agent@0.16.0` published to npm |
| 2026-02-15 | Issue #186 reported |

## Proposed Solutions

### Solution 1: Update `@openrouter/ai-sdk-provider` (Recommended)

Update the dependency version from `^1.5.4` to `^2.2.3` which supports AI SDK v6:

```json
{
  "dependencies": {
    "@openrouter/ai-sdk-provider": "^2.2.3"
  }
}
```

**Benefits**:
- Direct fix for the root cause
- Uses latest stable version with AI SDK v6 support
- No breaking changes (same API surface)

### Solution 2: Update `@opentui/solid` and `@opentui/core`

Update to latest versions (0.1.79) which may have updated peer dependencies:

```json
{
  "dependencies": {
    "@opentui/solid": "^0.1.79",
    "@opentui/core": "^0.1.79"
  }
}
```

**Note**: Testing shows `@opentui/solid@0.1.79` still requires exact `solid-js@1.9.9`. This may need to be reported to the `@opentui` maintainers.

### Solution 3: Pin solid-js version (Workaround)

Pin solid-js to the exact version required by `@opentui/solid`:

```json
{
  "dependencies": {
    "solid-js": "1.9.9"
  }
}
```

**Note**: This is a workaround, not a fix. The ideal solution is for `@opentui/solid` to accept a range like `^1.9.9`.

## Related Issues and PRs

### In This Repository
- Issue #186: Original bug report
- Issue #173: Bundle AI SDK providers to prevent runtime installation timeouts
- PR #185: Fix to bundle providers (introduced the `@openrouter/ai-sdk-provider@^1.5.4` dependency)

### External Repositories
- [OpenRouterTeam/ai-sdk-provider#307](https://github.com/OpenRouterTeam/ai-sdk-provider/pull/307): AI SDK v6 support (merged)
- [OpenRouterTeam/ai-sdk-provider@2.0.0](https://github.com/OpenRouterTeam/ai-sdk-provider/releases/tag/2.0.0): Release with AI SDK v6 support

## Fix Implementation

The fix involves updating the `@openrouter/ai-sdk-provider` dependency from `^1.5.4` to `^2.2.3`:

```diff
  "dependencies": {
-   "@openrouter/ai-sdk-provider": "^1.5.4",
+   "@openrouter/ai-sdk-provider": "^2.2.3",
  }
```

For the `solid-js` warning, this requires upstream changes in `@opentui/solid` to accept a version range instead of an exact version. An issue should be reported to the OpenTUI maintainers.

## References

- [AI SDK v6 Documentation](https://ai-sdk.dev/)
- [OpenRouter AI SDK Provider NPM](https://www.npmjs.com/package/@openrouter/ai-sdk-provider)
- [OpenRouter AI SDK Provider GitHub](https://github.com/OpenRouterTeam/ai-sdk-provider)
- [Bun Peer Dependency Warning Documentation](https://bun.sh/docs/cli/install#peer-dependencies)
