# Case Study: Issue #173 - `--model kilo/glm-5-free` Timeout

## Overview

**Issue**: [link-assistant/agent#173](https://github.com/link-assistant/agent/issues/173)
**Status**: Bug
**Reported**: 2026-02-14
**Reporter**: @konard

When using the `--model kilo/glm-5-free` option with the agent CLI, the application hangs indefinitely while attempting to dynamically install the `@openrouter/ai-sdk-provider` package at runtime.

## Problem Description

The agent CLI uses dynamic package installation via `bun add` to load provider SDK packages at runtime. When the Kilo provider is selected, the system attempts to install `@openrouter/ai-sdk-provider@latest`, which times out after 60 seconds (3 attempts x 60 seconds each = ~3 minutes total).

### Error Logs

```json
{
  "type": "log",
  "level": "info",
  "service": "bun",
  "cmd": ["/home/hive/.bun/bin/bun", "add", "--force", "--exact", "--cwd", "/home/hive/.cache/link-assistant-agent", "@openrouter/ai-sdk-provider@latest"],
  "timeout": 60000,
  "message": "running"
}

{
  "type": "log",
  "level": "error",
  "service": "bun",
  "timeout": 60000,
  "signalCode": "SIGTERM",
  "message": "command timed out"
}

{
  "type": "log",
  "level": "error",
  "service": "bun",
  "message": "Package installation timed out. This may be due to network issues or Bun hanging. Try: 1) Check network connectivity, 2) Run \"bun pm cache rm\" to clear cache, 3) Check for IPv6 issues (try disabling IPv6)"
}
```

## Timeline of Events

1. **User executes**: `echo "hi" | agent --model kilo/glm-5-free --verbose`
2. **Agent starts**: Creates session, parses input
3. **Provider initialization**: Identifies `kilo` provider needs `@openrouter/ai-sdk-provider`
4. **Dynamic installation**: Calls `BunProc.install('@openrouter/ai-sdk-provider', 'latest')`
5. **Bun subprocess**: Executes `bun add --force --exact --cwd /home/hive/.cache/link-assistant-agent @openrouter/ai-sdk-provider@latest`
6. **Timeout**: After 60 seconds, subprocess receives SIGTERM
7. **Retry**: Process retries 2 more times (MAX_RETRIES=3)
8. **Failure**: After 3 attempts, throws `BunInstallFailedError`
9. **Error propagation**: `ProviderInitError` is thrown, agent exits

## Root Cause Analysis

### Primary Issue: Dynamic Package Installation via Bun

The link-assistant/agent uses dynamic package installation at runtime via the `BunProc.install()` function (`js/src/bun/index.ts`). This approach has several problems:

1. **Known Bun Installation Issues**: There are multiple documented issues with `bun install` hanging:
   - [oven-sh/bun#5831](https://github.com/oven-sh/bun/issues/5831) - bun install hangs sporadically
   - [oven-sh/bun#26341](https://github.com/oven-sh/bun/issues/26341) - bun install hangs when failing to fetch dependencies
   - [oven-sh/bun#22846](https://github.com/oven-sh/bun/issues/22846) - bun install hangs in monorepo
   - [oven-sh/bun#25624](https://github.com/oven-sh/bun/issues/25624) - bun install hangs at 'Resolving dependencies'

2. **Network Dependency**: Runtime package installation requires network access, which:
   - Can be slow on constrained networks
   - May fail in air-gapped environments
   - Introduces unpredictable latency

3. **Race Conditions**: When multiple messages trigger provider initialization simultaneously, there can be race conditions even with the locking mechanism.

### Comparison with Kilo (Working Implementation)

The [Kilo CLI](https://github.com/Kilo-Org/kilo) is a fork of OpenCode that **does not have this problem**. Key difference:

**Kilo's approach** (`/tmp/kilo-repo/packages/opencode/package.json` lines 89, 18-85):

```json
"dependencies": {
  "@openrouter/ai-sdk-provider": "1.5.4",
  "@ai-sdk/anthropic": "2.0.58",
  "@ai-sdk/google": "2.0.52",
  // ... all AI SDK providers listed as static dependencies
}
```

And in the provider code (`/tmp/kilo-repo/packages/opencode/src/provider/provider.ts`):

```typescript
// Direct imports for bundled providers
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
// ... all providers imported statically

const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/anthropic": createAnthropic,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  // ... all providers mapped to their factory functions
}

async function getSDK(model: Model) {
  // ...
  const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
  if (bundledFn) {
    log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
    const loaded = bundledFn({ name: model.providerID, ...options })
    s.sdk.set(key, loaded)
    return loaded as SDK
  }

  // Only falls back to dynamic installation for non-bundled providers
  let installedPath = await BunProc.install(model.api.npm, "latest")
  // ...
}
```

**Key difference**: Kilo bundles all common providers as static dependencies and only uses dynamic installation as a fallback for custom/uncommon providers.

## Proposed Solutions

### Solution 1: Bundle @openrouter/ai-sdk-provider as Static Dependency (Recommended)

Add `@openrouter/ai-sdk-provider` as a static dependency in `package.json` and create a `BUNDLED_PROVIDERS` map similar to Kilo.

**Pros:**
- No runtime network dependency for common providers
- Instant provider initialization
- Works in air-gapped environments
- Follows the pattern used by the working Kilo implementation

**Cons:**
- Increases package size
- Requires version updates to get new provider features
- Need to maintain list of bundled providers

### Solution 2: Pre-install Providers During Package Installation

Add a `postinstall` script that pre-installs all common AI SDK providers to the cache directory.

```json
{
  "scripts": {
    "postinstall": "node scripts/preinstall-providers.js"
  }
}
```

**Pros:**
- Providers installed during npm install, not at runtime
- Still allows dynamic updates

**Cons:**
- Adds to install time
- May still fail if Bun hangs during postinstall

### Solution 3: Increase Timeout and Improve Error Handling

Increase the `INSTALL_TIMEOUT_MS` from 60 seconds to 180 seconds and add better retry logic with exponential backoff.

**Pros:**
- Simple change
- May work for slow networks

**Cons:**
- Doesn't address the root cause (Bun hanging)
- User experience still poor on timeout

### Solution 4: Add Fallback to npm/npx

If `bun add` times out, fall back to `npm install` or `npx` for package installation.

**Pros:**
- npm is generally more stable than bun for package installation
- Provides redundancy

**Cons:**
- Requires npm to be installed
- May still be slow

## Recommended Implementation

**Primary Fix**: Implement Solution 1 - Bundle common AI SDK providers as static dependencies.

The changes needed:

1. Add to `package.json`:
```json
"dependencies": {
  "@openrouter/ai-sdk-provider": "^1.5.4"
}
```

2. Update `js/src/provider/provider.ts`:
```typescript
// Add static import at the top
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// Create BUNDLED_PROVIDERS map
const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  '@openrouter/ai-sdk-provider': createOpenRouter,
};

// In getSDK function, check bundled providers first
async function getSDK(provider: ModelsDev.Provider, model: ModelsDev.Model) {
  // ... existing code ...

  const bundledFn = BUNDLED_PROVIDERS[pkg];
  if (bundledFn) {
    log.info(() => ({
      message: 'using bundled provider',
      providerID: provider.id,
      pkg,
    }));
    const loaded = bundledFn({ name: provider.id, ...options });
    s.sdk.set(key, loaded);
    return loaded as SDK;
  }

  // Fall back to dynamic installation for non-bundled providers
  // ... existing dynamic installation code ...
}
```

## Workarounds for Users

Until the fix is implemented, users can try:

1. **Clear Bun cache**: `bun pm cache rm`
2. **Pre-install the package manually**:
   ```bash
   mkdir -p ~/.cache/link-assistant-agent
   cd ~/.cache/link-assistant-agent
   bun add @openrouter/ai-sdk-provider@latest
   ```
3. **Disable IPv6** (if applicable): Some Bun installation hangs are related to IPv6 issues
4. **Use a different provider**: Use providers that are already working (e.g., `opencode/*`, `claude-oauth/*`)

## Files Involved

- `js/src/provider/provider.ts` - Provider initialization and SDK loading
- `js/src/bun/index.ts` - Bun subprocess and package installation
- `package.json` - Dependencies declaration

## References

- [Issue #173](https://github.com/link-assistant/agent/issues/173)
- [Kilo CLI (working implementation)](https://github.com/Kilo-Org/kilo)
- [Bun issue #5831](https://github.com/oven-sh/bun/issues/5831)
- [Bun issue #26341](https://github.com/oven-sh/bun/issues/26341)
- [@openrouter/ai-sdk-provider npm](https://www.npmjs.com/package/@openrouter/ai-sdk-provider)
