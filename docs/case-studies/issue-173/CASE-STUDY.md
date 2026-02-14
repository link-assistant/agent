# Case Study: Issue #173 - `--model kilo/glm-5-free` Hangs Forever

## Summary

When using `--model kilo/glm-5-free`, the agent hangs indefinitely during provider package installation. The process gets stuck at the `bun add @openrouter/ai-sdk-provider@latest` command.

## Timeline of Events

### Sequence of Events (from verbose logs)

1. **T+0ms**: Agent started with `--model kilo/glm-5-free --verbose`
2. **T+32ms**: Model parsed: `providerID: "kilo"`, `modelID: "glm-5-free"`
3. **T+113ms**: Provider state initialization started
4. **T+136ms**: Provider SDK requested for `kilo` provider
5. **T+137ms**: Package installation initiated: `@openrouter/ai-sdk-provider@latest`
6. **T+138ms**: `bun add` command spawned
7. **∞**: Process hangs indefinitely - no completion, no error

### The Hanging Command

```json
{
  "type": "log",
  "level": "info",
  "timestamp": "2026-02-14T13:43:01.984Z",
  "service": "bun",
  "cmd": [
    "/home/hive/.bun/bin/bun",
    "add",
    "--force",
    "--exact",
    "--cwd",
    "/home/hive/.cache/link-assistant-agent",
    "@openrouter/ai-sdk-provider@latest"
  ],
  "cwd": "/home/hive/.cache/link-assistant-agent",
  "message": "running"
}
```

## Root Cause Analysis

### Primary Issue: Missing Timeout in Bun.spawn

The `BunProc.run()` function in `js/src/bun/index.ts` uses `Bun.spawn()` without a `timeout` option:

```typescript
const result = Bun.spawn([which(), ...cmd], {
  ...options,
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    ...process.env,
    ...options?.env,
    BUN_BE_BUN: '1',
  },
});
```

Without a timeout, if `bun add` encounters any of the known hanging issues, the process waits indefinitely.

### Known Bun Package Manager Hang Issues

Based on research, several Bun issues can cause `bun add`/`bun install` to hang:

1. **HTTP 304 Response Handling** ([Issue #5831](https://github.com/oven-sh/bun/issues/5831))
   - Improper handling of HTTP 304 (Not Modified) responses
   - IPv6 configuration issues causing connection hangs
   - Fixes merged in PR #6192 and PR #15511

2. **Failed Dependency Fetch** ([Issue #26341](https://github.com/oven-sh/bun/issues/26341))
   - When tarball download fails (e.g., 401 Unauthorized), `bun install` hangs
   - Missing error callback in isolated install mode
   - Fix merged in PR #26342

3. **Large Package Count** ([Issue #23607](https://github.com/oven-sh/bun/issues/23607))
   - Security scanner causes hang with 790+ packages
   - Hang occurs in scanner loading mechanism

4. **Containerized Linux Environments** ([Issue #25624](https://github.com/oven-sh/bun/issues/25624))
   - `bun install` hangs at "Resolving dependencies"
   - Issues with Bun's in-memory resolution algorithm

### Contributing Factors

1. **Network Conditions**: The user's environment may have intermittent network issues
2. **IPv6 Configuration**: IPv6 issues can cause Bun to hang on DNS resolution
3. **Cache State**: Corrupted or partial cache can trigger hangs
4. **Missing Timeout**: The `BunProc.run()` function has no timeout mechanism

## Proposed Solutions

### Solution 1: Add Timeout to BunProc.run (Recommended)

Add a timeout option to the `Bun.spawn()` call in `BunProc.run()`:

```typescript
export async function run(
  cmd: string[],
  options?: Bun.SpawnOptions.OptionsObject<any, any, any> & { timeout?: number }
) {
  const timeout = options?.timeout ?? 120000; // 2 minutes default

  log.info(() => ({
    message: 'running',
    cmd: [which(), ...cmd],
    timeout,
    ...options,
  }));

  const result = Bun.spawn([which(), ...cmd], {
    ...options,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout, // Add timeout support
    killSignal: 'SIGTERM', // Graceful termination
    env: {
      ...process.env,
      ...options?.env,
      BUN_BE_BUN: '1',
    },
  });
  // ...
}
```

### Solution 2: Pre-bundle the @openrouter/ai-sdk-provider Package

Instead of dynamically installing the package at runtime, pre-install it as a dependency:

```json
// package.json
{
  "dependencies": {
    "@openrouter/ai-sdk-provider": "^2.2.3"
  }
}
```

This is how KiloCode and Kilo repositories handle the provider package.

### Solution 3: Use AbortSignal for More Control

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 120000);

const result = Bun.spawn([which(), ...cmd], {
  signal: controller.signal,
  // ...
});

const code = await result.exited;
clearTimeout(timeoutId);
```

### Solution 4: Add Retry with Exponential Backoff

If the package installation fails, retry with exponential backoff:

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    await BunProc.run(args, { cwd, timeout: 60000 });
    break; // Success
  } catch (e) {
    if (attempt === MAX_RETRIES) throw e;
    await delay(BASE_DELAY * Math.pow(2, attempt - 1));
  }
}
```

## Recommended Fix

Implement **Solution 1** with a reasonable timeout (60-120 seconds) for package installation. This prevents indefinite hangs while still allowing enough time for legitimate package installations.

Additionally, consider implementing **Solution 2** for commonly-used provider packages to avoid runtime installation altogether.

## References

### Related Issues

- [Bun Issue #5831: bun install hangs sporadically](https://github.com/oven-sh/bun/issues/5831)
- [Bun Issue #26341: Bun install hangs when failing to fetch](https://github.com/oven-sh/bun/issues/26341)
- [Bun Issue #23607: bun install hangs with security scanner](https://github.com/oven-sh/bun/issues/23607)
- [Bun Issue #25624: bun install hangs in containerized Linux](https://github.com/oven-sh/bun/issues/25624)

### Bun Documentation

- [Bun Spawn Documentation](https://bun.sh/docs/runtime/child-process)
- Timeout option: `timeout: number` (milliseconds)
- Kill signal: `killSignal: "SIGTERM" | "SIGKILL" | ...`

### KiloCode/Kilo Reference Implementation

The Kilo provider implementation uses:
- Pre-installed `@openrouter/ai-sdk-provider` package
- API endpoint: `https://api.kilo.ai/api/openrouter/`
- Custom headers: `X-KILOCODE-EDITORNAME`, `User-Agent`

## Workarounds

### For Users

1. **Pre-install the package manually**:
   ```bash
   bun add @openrouter/ai-sdk-provider
   ```

2. **Clear Bun cache**:
   ```bash
   bun pm cache rm
   ```

3. **Disable IPv6** (if applicable):
   ```bash
   # Linux
   sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1
   ```

4. **Use a different model** while the issue is being fixed:
   ```bash
   echo "hi" | agent --model opencode/grok-code --verbose
   ```

## Files Affected

- `js/src/bun/index.ts` - Main fix location (add timeout)
- `js/src/provider/provider.ts` - Provider SDK loading
