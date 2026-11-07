# Case Study: Issue #21 - Supporting Both Single-Language and Multi-Language Repositories

## Executive Summary

This case study analyzes two related CI/CD pipeline failures in the [link-assistant/agent](https://github.com/link-assistant/agent) repository and documents best practices for supporting both single-language and multi-language repository structures in CI/CD scripts.

The issues stemmed from:

1. **Issue #111**: npm peer dependency conflicts requiring `--legacy-peer-deps` flag
2. **Issue #113**: Working directory corruption caused by the `command-stream` library's virtual `cd` command

## Background

The link-assistant/agent repository is a multi-language monorepo containing:

- JavaScript/TypeScript code in the `js/` subfolder
- Rust code in the `rust/` subfolder

The CI/CD scripts needed to support both:

- **Multi-language repositories** (like link-assistant/agent) where `package.json` is at `./js/package.json`
- **Single-language repositories** where `package.json` is at `./package.json` (repository root)

## Timeline of Events

### Issue #111 - npm ERESOLVE Error

| Timestamp (UTC)     | Event                                                  |
| ------------------- | ------------------------------------------------------ |
| 2026-01-08 02:22:24 | CI Run #20803315337 triggered on push to main branch   |
| 2026-01-08 02:22:46 | Lint and Format Check completed successfully           |
| 2026-01-08 02:22:29 | Ubuntu unit tests passed                               |
| 2026-01-08 02:22:32 | macOS unit tests passed                                |
| 2026-01-08 02:23:24 | Windows unit tests passed                              |
| 2026-01-08 02:23:32 | Release job started                                    |
| 2026-01-08 02:23:55 | Changeset version ran successfully                     |
| 2026-01-08 02:23:56 | `npm install --package-lock-only` failed with ERESOLVE |
| 2026-01-08 02:23:58 | Release job failed with exit code 1                    |

### Issue #113 - Working Directory Corruption

| Timestamp (UTC)     | Event                                                              |
| ------------------- | ------------------------------------------------------------------ |
| 2026-01-10 22:38:48 | PR #112 merged (fixed --legacy-peer-deps)                          |
| 2026-01-10 22:38:56 | CI Run #20885464993 triggered                                      |
| 2026-01-10 22:40:29 | Version bump completed successfully                                |
| 2026-01-10 22:40:29 | Error: ENOENT: no such file or directory, open './js/package.json' |
| 2026-01-10 22:40:29 | Release job failed with exit code 1                                |

## Root Cause Analysis

### Root Cause #1: Missing `--legacy-peer-deps` Flag

**Problem**: The release scripts (`changeset-version.mjs` and `instant-version-bump.mjs`) were running `npm install --package-lock-only` without the `--legacy-peer-deps` flag.

**Error Message**:

```
npm error code ERESOLVE
npm error ERESOLVE could not resolve
npm error While resolving: @opentui/solid@0.1.60
npm error Found: solid-js@1.9.10
npm error Could not resolve dependency:
npm error peer solid-js@"1.9.9" from @opentui/solid@0.1.60
```

**Root Cause**: Starting with npm 7, the package manager enforces stricter peer dependency rules. The project had conflicting peer dependency requirements:

- `@opentui/solid@0.1.60` required exactly `solid-js@1.9.9`
- The root project specified `solid-js@^1.9.10`

**Inconsistency**: The workflow file (`js.yml`) correctly used `--legacy-peer-deps` for initial `npm install`, but the release scripts did not.

### Root Cause #2: Virtual `cd` Command Behavior

**Problem**: The `command-stream` library implements `cd` as a virtual command that calls `process.chdir()` on the Node.js process itself, permanently changing the working directory.

**Code Flow**:

```
Repository Root (/)
├── js/
│   └── package.json    <- Target file
└── scripts/
    └── version-and-commit.mjs

1. Script starts with cwd = /
2. Script runs: await $`cd js && npm run changeset:version`
3. command-stream's cd command calls: process.chdir('js')
4. cwd is now /js/
5. Script tries to read: readFileSync('./js/package.json')
6. This resolves to: /js/js/package.json <- DOES NOT EXIST!
7. Error: ENOENT
```

**Error Message**:

```
Error: ENOENT: no such file or directory, open './js/package.json'
```

**Why This Was Hard to Detect**:

- The `cd` command in most shell scripts only affects the subprocess, not the parent process
- Developers familiar with Unix shells would not expect `cd` to affect the Node.js process
- The error message didn't clearly indicate that the working directory had changed
- The `command-stream` library documentation doesn't prominently warn about this behavior

## Solutions Implemented

### Solution #1: Add `--legacy-peer-deps` Flag (PR #112)

**Files Modified**:

- `scripts/changeset-version.mjs`
- `scripts/instant-version-bump.mjs`

**Change**:

```javascript
// Before
await $`npm install --package-lock-only`;

// After
await $`npm install --package-lock-only --legacy-peer-deps`;
```

### Solution #2: Working Directory Restoration and Auto-Detection (PR #114)

**New Utility Modules Created**:

- `scripts/js-paths.mjs` - JavaScript package root detection
- `scripts/rust-paths.mjs` - Rust package root detection

**Key Features**:

1. **Automatic Package Root Detection**:
   - Check for `./package.json` or `./Cargo.toml` first (single-language repo)
   - If not found, check `./js/` or `./rust/` subfolder (multi-language repo)
   - Throw helpful error if neither exists

2. **Explicit Configuration Options**:
   - CLI arguments: `--js-root <path>` or `--rust-root <path>`
   - Environment variables: `JS_ROOT` or `RUST_ROOT`

3. **Working Directory Preservation**:

   ```javascript
   // Store the original working directory
   const originalCwd = process.cwd();

   try {
     // Code that uses cd
     await $`cd js && npm run changeset:version`;

     // Restore the original working directory
     process.chdir(originalCwd);

     // Now file operations work correctly
     const packageJson = JSON.parse(readFileSync('./js/package.json', 'utf8'));
   } catch (error) {
     // Handle error
   }
   ```

**Updated Scripts**:

- `scripts/version-and-commit.mjs`
- `scripts/instant-version-bump.mjs`
- `scripts/publish-to-npm.mjs`
- `scripts/rust-version-and-commit.mjs`
- `scripts/rust-collect-changelog.mjs`
- `scripts/rust-get-bump-type.mjs`

## Best Practices for Multi-Language Repositories

Based on this case study and industry research, here are recommended best practices:

### 1. Consistent npm Flag Usage

**Problem**: Using `--legacy-peer-deps` in some places but not others causes inconsistent behavior.

**Best Practice**:

- If using `--legacy-peer-deps`, use it consistently across all npm install commands
- Consider adding a `.npmrc` file with `legacy-peer-deps=true` for project-wide consistency
- Document the reason for using this flag for future maintainers

### 2. Automatic Package Root Detection

**Problem**: Hardcoding paths like `./js/package.json` doesn't work for single-language repos.

**Best Practice**:

```javascript
// Detect JavaScript package root
function getJsRoot() {
  if (existsSync('./package.json')) return '.'; // Single-language
  if (existsSync('./js/package.json')) return 'js'; // Multi-language
  throw new Error('package.json not found');
}
```

### 3. Working Directory Management

**Problem**: Some shell libraries modify `process.cwd()` unexpectedly.

**Best Practice**:

- Always save and restore the original working directory when using `cd` commands
- Use absolute paths when possible
- Prefer `--prefix` or `--cwd` options over `cd` when available

### 4. Modular Project Structure

**Best Practice**: Organize multi-language repositories with clear separation:

```
repository/
├── js/               # JavaScript/TypeScript
│   ├── package.json
│   └── src/
├── rust/             # Rust
│   ├── Cargo.toml
│   └── src/
├── scripts/          # Shared CI/CD scripts
└── .github/workflows/
```

### 5. Unified Task Commands

**Best Practice**: Provide unified scripts that work across both repo structures:

```bash
# Auto-detection (default)
node scripts/version-and-commit.mjs --mode changeset

# Explicit configuration
node scripts/version-and-commit.mjs --mode changeset --js-root js

# Via environment variable
JS_ROOT=js node scripts/version-and-commit.mjs --mode changeset
```

### 6. Caching Language-Specific Artifacts

**Best Practice**: Cache appropriately based on language:

- JavaScript: `node_modules/`, `package-lock.json`
- Rust: `target/`, `Cargo.lock`
- Use remote caches for CI efficiency

## Lessons Learned

1. **Understand Library Internals**: Third-party libraries may have non-obvious behaviors. The `command-stream` library's virtual `cd` command is powerful but can cause issues if not handled properly.

2. **Consistency is Key**: When using npm flags like `--legacy-peer-deps`, ensure they are used consistently across all npm install commands in both workflow files and scripts.

3. **Test Release Workflows**: Release workflows often run in different conditions than regular CI. Test them separately to catch issues like these.

4. **Add Defensive Code**: When using commands that modify process state, always save and restore the original state.

5. **Document Non-Obvious Behaviors**: Include detailed comments explaining why certain patterns (like `process.chdir()` restoration) are necessary.

6. **Support Multiple Repository Structures**: Design CI/CD scripts to auto-detect and support both single-language and multi-language repository structures.

## References

### External Resources

- [Managing multiple languages in a monorepo](https://graphite.dev/guides/managing-multiple-languages-in-a-monorepo)
- [Monorepo Explained](https://monorepo.tools/)
- [Benefits and challenges of monorepo development practices - CircleCI](https://circleci.com/blog/monorepo-dev-practices/)
- [Building a Monorepo with Rust - Earthly Blog](https://earthly.dev/blog/rust-monorepo/)
- [Node.js process.chdir() Method - GeeksforGeeks](https://www.geeksforgeeks.org/node-js-process-chdir-method/)
- [Fix 'npm ERR! ERESOLVE unable to resolve dependency tree'](https://blog.openreplay.com/fix-npm-err-eresolve-dependency/)
- [Resolving NPM Peer Dependency Conflicts](https://medium.com/@robert.maiersilldorff/resolving-npm-peer-dependency-conflicts-70d67f4ca7dc)

### Related Issues and Pull Requests

- [Issue #111](https://github.com/link-assistant/agent/issues/111) - JS release does not work
- [Issue #113](https://github.com/link-assistant/agent/issues/113) - JavaScript publish does not work
- [PR #112](https://github.com/link-assistant/agent/pull/112) - fix: Add --legacy-peer-deps flag to release scripts
- [PR #114](https://github.com/link-assistant/agent/pull/114) - feat: Add configurable package root for release scripts

### CI Logs (Preserved)

- `ci-logs/run-20803315337.txt` - Issue #111 CI failure log
- `ci-logs/run-20885464993.txt` - Issue #113 CI failure log

## Proposed Solutions for This Template Repository

Based on the analysis above, this template repository (js-ai-driven-development-pipeline-template) should incorporate these solutions to ensure best practices by default:

### 1. Add Path Detection Utilities

Create `scripts/js-paths.mjs` with automatic package root detection:

- Support `./package.json` for single-language repos
- Support `./js/package.json` for multi-language repos
- Provide CLI and environment variable configuration options

### 2. Update Release Scripts

Modify all release scripts to:

- Use the path detection utilities
- Save and restore `process.cwd()` after `cd` commands
- Use `--legacy-peer-deps` consistently for npm commands

### 3. Add `.npmrc` Configuration (Optional)

Consider adding a `.npmrc` file with:

```
legacy-peer-deps=true
```

### 4. Document the Approach

Update repository documentation to explain:

- How scripts auto-detect repository structure
- How to configure for different project layouts
- Known limitations and workarounds

### 5. Prevent False Positives in CI/CD (Based on Issue #115/PR #116)

**Problem**: The `changeset publish` command exits with code 0 even when packages fail to publish. The `command-stream` library doesn't throw exceptions on non-zero exit codes. This can result in false positive CI/CD statuses where failures are reported as successes.

**Best Practice**: Implement multi-layer failure detection:

1. **Output pattern matching** - Scan command output for failure patterns:

   ```javascript
   const FAILURE_PATTERNS = [
     'packages failed to publish',
     'error occurred while publishing',
     'npm error code E',
     'npm error 404',
     'npm error 401',
     'npm error 403',
     'Access token expired',
     'ENEEDAUTH',
   ];

   function detectPublishFailure(output) {
     const lowerOutput = output.toLowerCase();
     for (const pattern of FAILURE_PATTERNS) {
       if (lowerOutput.includes(pattern.toLowerCase())) {
         return pattern;
       }
     }
     return null;
   }
   ```

2. **Exit code checking** - Check the exit code even though `changeset` may return 0 on failure:

   ```javascript
   if (result.code !== 0) {
     throw new Error(`Publish failed with exit code ${result.code}`);
   }
   ```

3. **Post-publish verification** - Verify the package is actually on npm:

   ```javascript
   async function verifyPublished(packageName, version) {
     const result = await $`npm view "${packageName}@${version}" version`.run({
       capture: true,
     });
     return result.code === 0 && result.stdout.trim().includes(version);
   }
   ```

4. **Use `.run({ capture: true })`** - Capture command output for analysis instead of just running and assuming success.

**Related References**:

- [Issue #115](https://github.com/link-assistant/agent/issues/115) - Error was treated as success
- [PR #116](https://github.com/link-assistant/agent/pull/116) - fix: Add publish verification and failure detection to prevent false positives
- [Changesets Issue #1621](https://github.com/changesets/changesets/issues/1621) - Git tag failure isn't handled
- [Changesets Issue #1280](https://github.com/changesets/changesets/issues/1280) - Action succeeds but package is never published
