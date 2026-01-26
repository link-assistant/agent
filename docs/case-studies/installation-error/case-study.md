# Installation Error Case Study

## Issue Summary

**Title:** Ошибка установки (Installation Error)  
**URL:** https://github.com/link-assistant/agent/issues/5  
**Status:** Open  
**Author:** unidel2035  
**Created:** (from issue data)

**Description:**  
User reports an installation error when attempting to use the @link-assistant/agent package after global installation with Bun. The error message is:

```
error: For security reasons, macros cannot be run from node_modules.
    at /home/unidel/node_modules/@link-assistant/agent/src/provider/models.ts:75:24
```

The full installation log shows successful installation of Bun and the package, but failure on first run.

## Timeline of Events

1. **User installs Bun:**  
   Executes `curl -fsSL https://bun.sh/install | bash`  
   Bun v1.3.2 is installed successfully.

2. **Global package installation:**  
   Runs `bun install -g @link-assistant/agent`  
   Package @link-assistant/agent@0.0.2 installs with binary "agent"  
   Notes some warnings about lockfile migration and peer dependencies.

3. **First run attempt:**  
   Executes `echo "hi" | agent`  
   Runtime fails with macro security error.

## Root Cause Analysis

The root cause is Bun's security restriction on macro execution from node_modules combined with the package's publishing strategy.

**Technical Details:**

- The package uses a Bun macro in `src/provider/models-macro.ts` to fetch API data at build time
- The macro is imported in `src/provider/models.ts` with `import { data } from "./models-macro" with { type: "macro" }`
- The package is published as source code (TypeScript files) rather than bundled JavaScript
- When installed globally, the code resides in node_modules
- Bun prevents macro execution from node_modules for security reasons
- The binary attempts to execute the macro at runtime, triggering the error

**Why this happens:**
Bun macros are designed to run at bundle-time, inlining their results. Publishing source code means macros run at runtime instead, which is blocked when the code is in node_modules to prevent potential security issues.

## Proposed Solutions

### 1. Build Package Before Publishing (Recommended)

- Add a build script using `bun build` to compile TypeScript to JavaScript with macros inlined
- Update `package.json`:
  - Change `bin` to point to built file (e.g., `dist/index.js`)
  - Change `files` to include `dist/` instead of `src/`
  - Add `main` pointing to built file
- This ensures macros are executed at build time, not runtime

### 2. Runtime Data Fetching Alternative

- Modify `models-macro.ts` to perform the fetch at runtime instead of build time
- Remove macro import and implement caching mechanism
- Trade-off: Potential performance impact and increased runtime dependencies

### 3. User Workaround

- Install package locally instead of globally: `bun add @link-assistant/agent` then run with `bunx agent`
- Less convenient for CLI tool usage

## References

- [Bun Macros Documentation](https://bun.sh/docs/bundler/macros) - Official documentation explaining macro security restrictions
- [JavaScript Macros in Bun Blog Post](https://bun.com/blog/bun-macros) - Introduction to Bun macros and their security model
- Issue data archived in `issue-5.json`
