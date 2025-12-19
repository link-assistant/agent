# Case Study: Issue #72 - "Looks like 0.3.0 version is completely broken"

## Executive Summary

**Issue:** [#72](https://github.com/link-assistant/agent/issues/72)
**Severity:** Critical (application fails to start)
**Root Cause:** Bun package cache corruption causing `@ai-sdk/openai-compatible` installation failure
**Version Affected:** 0.3.0
**Status:** Identified and solution proposed

## Timeline of Events

### 2025-12-18

- **23:19:28 UTC** - Commit `ae22c35`: Set opencode/grok-code as default model
- **Multiple commits** - PR #71 changes for migration from .opencode to .link-assistant-agent

### 2025-12-19

- **09:31:00 UTC** - Commit `c3cb3a8`: Implement automatic migration
- **09:38:46 UTC** - PR #71 merged
- **Unknown time** - Version 0.3.0 released
- **~20:50:00 UTC** - User reports complete failure in Issue #72

## Problem Description

### User Report

```bash
konard@MacBook-Pro-Konstantin ~ % echo "hi" | agent
ProviderInitError: ProviderInitError
 data: {
  providerID: "opencode",
},
```

### What User Expected

- Agent to start normally and respond to "hi" message
- Behavior similar to version 0.2.1

### What Actually Happened

- Application crashed with `ProviderInitError`
- No response from agent
- Complete failure to initialize

## Root Cause Analysis

### Layer 1: Surface Error

The visible error is `ProviderInitError` with `providerID: "opencode"` at `src/provider/provider.ts:789`.

### Layer 2: Installation Failure

Digging deeper into the error chain reveals:

```
BunInstallFailedError: BunInstallFailedError
 data: {
  pkg: "@ai-sdk/openai-compatible",
  version: "latest",
  details: "Command failed with exit code 1
stderr: FileNotFound: failed copying files from cache to destination for package zod"
}
```

### Layer 3: Bun Cache Corruption (Root Cause)

The actual root cause is:

```
FileNotFound: failed copying files from cache to destination for package zod
```

This is a **Bun runtime cache corruption issue**, not a code defect in the agent itself.

## Contributing Factors

### 1. Default Model Change (ae22c35)

In commit `ae22c35`, the default model was changed to `opencode/grok-code`:

```typescript
const priority = [
  'grok-code', // ← Added as highest priority
  'gpt-5',
  'claude-sonnet-4',
  'big-pickle',
  'gemini-3-pro',
];

// Prefer opencode provider if available
const opencodeProvider = providers.find((p) => p.info.id === 'opencode');
if (opencodeProvider) {
  const [model] = sort(Object.values(opencodeProvider.info.models));
  if (model) {
    return {
      providerID: opencodeProvider.info.id,
      modelID: model.id,
    };
  }
}
```

**Impact:** On first run without config, agent now tries to initialize opencode provider, which requires installing `@ai-sdk/openai-compatible`.

### 2. OpenCode Provider Configuration

The opencode provider from models.dev API uses:

```json
{
  "id": "opencode",
  "npm": "@ai-sdk/openai-compatible",
  "api": "https://opencode.ai/zen/v1",
  "name": "OpenCode Zen"
}
```

**Impact:** Initializing this provider requires Bun to install `@ai-sdk/openai-compatible@latest` (v1.0.29).

### 3. Bun Installation Process

The agent's dynamic provider loading (src/bun/index.ts:68-131) installs packages on-demand:

```typescript
export async function install(pkg: string, version = 'latest') {
  const mod = path.join(Global.Path.cache, 'node_modules', pkg);
  // ... package.json management ...

  await BunProc.run(args, {
    cwd: Global.Path.cache,
  }).catch((e) => {
    throw new InstallFailedError(
      { pkg, version, details: e instanceof Error ? e.message : String(e) },
      { cause: e }
    );
  });
  // ...
}
```

**Impact:** When Bun's cache is corrupted, this installation fails.

### 4. Bun Cache Corruption

Bun maintains a global package cache that occasionally becomes corrupted, particularly with the `zod` package (a common dependency).

**Impact:** Installation of `@ai-sdk/openai-compatible` fails because it depends on `zod`, and Bun cannot copy `zod` from its cache.

## Why Version 0.2.1 Worked

In version 0.2.1:

- Default model was NOT set to opencode/grok-code
- Agent would select another provider (likely Anthropic or OpenAI) if available
- User likely had API keys for other providers
- No attempt to install `@ai-sdk/openai-compatible` on startup

## Why Version 0.3.0 Fails

In version 0.3.0:

1. Default model is set to `opencode/grok-code` (highest priority)
2. On first run, agent tries to initialize opencode provider
3. Initialization requires installing `@ai-sdk/openai-compatible`
4. Bun cache is corrupted for `zod` package
5. Installation fails
6. Provider initialization fails
7. **Application crashes**

## Verification

### Reproduction

Successfully reproduced in clean environment:

```bash
$ echo "hi" | bun run src/index.js
ProviderInitError: ProviderInitError
 data: {
  providerID: "opencode",
},
```

Full error trace shows:

```
FileNotFound: failed copying files from cache to destination for package zod
```

### Evidence Files

- `docs/case-studies/issue-72/issue-data.json` - Original issue report
- `docs/case-studies/issue-72/models-dev-api.json` - Current models.dev state
- `docs/case-studies/issue-72/reproduction-attempt.log` - Reproduction logs
- `docs/case-studies/issue-72/bun-install.log` - Installation logs

## Proposed Solutions

### Solution 1: Add Graceful Fallback (Recommended)

**Priority:** High
**Effort:** Low
**Impact:** Fixes the issue for all users

Modify provider initialization to:

1. Catch provider init failures
2. Log warning instead of crashing
3. Try next available provider
4. Only crash if NO providers can be initialized

**Implementation location:** `src/provider/provider.ts:781-790`

**Benefits:**

- Resilient to transient installation failures
- Better user experience
- Maintains backward compatibility
- Users can still use the agent with other providers

**Code change:**

```typescript
// In defaultModel() function
try {
  const opencodeProvider = providers.find((p) => p.info.id === 'opencode');
  if (opencodeProvider) {
    const [model] = sort(Object.values(opencodeProvider.info.models));
    if (model) {
      try {
        // Verify provider can be initialized
        await getSDK(opencodeProvider.info, model);
        return {
          providerID: opencodeProvider.info.id,
          modelID: model.id,
        };
      } catch (initError) {
        log.warn(
          'Failed to initialize preferred opencode provider, falling back',
          {
            error:
              initError instanceof Error
                ? initError.message
                : String(initError),
          }
        );
      }
    }
  }
} catch (e) {
  log.warn('Error checking opencode provider, continuing with fallback');
}

// Fall back to any available provider
const provider = providers.find(
  (p) => !cfg.provider || Object.keys(cfg.provider).includes(p.info.id)
);
// ... rest of existing fallback logic
```

### Solution 2: Provide Cache Clear Instructions

**Priority:** Medium
**Effort:** Low
**Impact:** Helps users recover from cache corruption

Add better error messages when provider initialization fails:

```typescript
throw new InitError(
  {
    providerID: provider.id,
    help: 'If this error persists, try clearing Bun cache: rm -rf ~/.bun/install/cache',
  },
  { cause: e }
);
```

### Solution 3: Automatic Cache Recovery

**Priority:** Low
**Effort:** Medium
**Impact:** Automatically fixes cache issues

Detect cache-related failures and automatically:

1. Clear the specific package from cache
2. Retry installation
3. Log the recovery action

**Cons:**

- More complex
- Might hide underlying issues
- Requires careful implementation

## User Workarounds

Until fixed, users can work around this issue by:

### Workaround 1: Clear Bun Cache

```bash
rm -rf ~/.bun/install/cache
bun pm cache rm
```

### Workaround 2: Set Different Default Model

Create `~/.config/link-assistant-agent/opencode.json`:

```json
{
  "model": "anthropic/claude-sonnet-4-5"
}
```

### Workaround 3: Downgrade to 0.2.1

```bash
bun install -g @link-assistant/agent@0.2.1
```

## Lessons Learned

1. **Test version upgrades in clean environments** - Cache state can differ between development and production
2. **Fail gracefully** - Critical path changes (default model) should have robust error handling
3. **Document cache requirements** - Bun cache behavior should be documented
4. **Monitor runtime dependencies** - External package installation is a point of failure
5. **Provide better error messages** - Include actionable recovery steps in error output

## Related Issues

- Similar Bun cache issues reported in: [Bun #16682](https://github.com/oven-sh/bun/issues/16682)
- Package installation failures are a known Bun issue with some packages

## References

- Issue: https://github.com/link-assistant/agent/issues/72
- PR #71: https://github.com/link-assistant/agent/pull/71
- Commit ae22c35: Make opencode/grok-code the default model
- Commit c3cb3a8: Implement automatic migration
- Models.dev API: https://models.dev/api.json
- Bun documentation: https://bun.sh/docs

## Conclusion

Version 0.3.0 is NOT fundamentally broken in code, but **fails due to Bun runtime cache corruption** when trying to initialize the new default opencode provider. The issue is **environmental** rather than a code defect.

**Recommended Fix:** Implement graceful fallback (Solution 1) to make the agent resilient to provider initialization failures.

**Immediate Action:** Document the workaround in issue comments and implement the fix in PR #73.
