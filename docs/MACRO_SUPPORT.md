# Macro Support in Agent CLI

## Overview

The agent CLI uses [Bun macros](https://bun.sh/docs/bundler/macros) to optionally optimize the loading of model provider information from [models.dev](https://models.dev/api.json).

## How It Works

In `src/provider/models.ts`, we import the `data` function from `models-macro.ts` with the macro directive:

```typescript
import { data } from "./models-macro" with { type: "macro" }
```

When macros are supported, this function executes at **bundle-time** rather than runtime, potentially improving startup performance.

## Limitations

### Node Modules Restriction

**Important:** Due to Bun's security model, macros cannot execute from code installed in `node_modules`. This means:

- ✅ **Works**: When running the agent from source (development mode)
- ❌ **Does not work**: When installed globally via `bun install -g @deep-assistant/agent`
- ❌ **Does not work**: When installed as a dependency in another project

This is a fundamental security restriction in Bun, as documented in the [official Bun macro documentation](https://bun.sh/docs/bundler/macros):

> "For security reasons, macros cannot be run from node_modules."

### Fallback Behavior

The code is designed to gracefully fallback when macros are unavailable:

1. If the macro fails (e.g., when running from node_modules), the `data()` function is called normally at runtime
2. The runtime version fetches from `https://models.dev/api.json` or reads from `MODELS_DEV_API_JSON` environment variable
3. Results are cached in the user's cache directory for future use

## Testing

### Development Mode (Macros Enabled)

```bash
# Run from source - macros work
bun run src/index.js
```

### Production Mode (Macros Disabled)

```bash
# Simulate global install behavior
cd /tmp
bun install -g @deep-assistant/agent
echo "hi" | agent
```

When installed globally, the macro directive is ignored and runtime fetching is used automatically.

## Why Keep The Macro?

Even though macros don't work in production installs, we keep the macro implementation because:

1. **Development Performance**: Provides faster startup when developing the CLI
2. **Future Compatibility**: If Bun adds ways to bundle/compile packages, macros could work
3. **Graceful Degradation**: The fallback works seamlessly, so there's no downside

## Alternative Approaches Considered

### Pre-bundling

We investigated pre-bundling the application with `bun build` to inline macro results. However:

- Async macros with network fetching caused the bundler to hang
- This appears to be a limitation or bug in Bun's current macro implementation

### Cached JSON

We considered pre-fetching and bundling the models.dev JSON:

- This would add ~600KB to the package size
- The runtime fetch + cache approach works well and keeps package small
- Users only fetch the data once per cache refresh interval

## Conclusion

The current implementation provides the best of both worlds:
- Macro optimization for development
- Reliable runtime fetching for production
- Automatic fallback with no user configuration needed
