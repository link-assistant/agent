# Case Study: Issue #111 - JS Release Does Not Work

## Timeline of Events

### January 8, 2026 - CI Failure Discovery
- **Time:** 02:22 - 02:24 UTC
- **Trigger:** Push to main branch (`1730fae4a399750f320591a6dfd62cf40363f2ac`)
- **Workflow:** JS CI/CD Pipeline (js.yml)
- **Run ID:** 20803315337

### Sequence of Events

1. **02:22:24** - Lint and Format Check job starts
2. **02:22:23** - Unit Tests (Bun on ubuntu-latest) starts
3. **02:22:25** - Unit Tests (Bun on windows-latest) starts
4. **02:22:24** - Unit Tests (Bun on macos-latest) starts
5. **02:22:46** - Lint and Format Check completes successfully
6. **02:22:29** - Ubuntu unit tests pass (0 failures)
7. **02:22:32** - macOS unit tests pass (0 failures)
8. **02:23:24** - Windows unit tests pass (0 failures)
9. **02:23:32** - Release job starts
10. **02:23:55** - Changeset version runs successfully
11. **02:23:56** - npm install --package-lock-only fails with ERESOLVE
12. **02:23:58** - Release job fails with exit code 1

## Root Cause Analysis

### Primary Root Cause
The `changeset-version.mjs` script runs `npm install --package-lock-only` without the `--legacy-peer-deps` flag, causing peer dependency resolution failures.

### Error Chain

```
npm error code ERESOLVE
npm error ERESOLVE could not resolve

npm error While resolving: @opentui/solid@0.1.60
npm error Found: solid-js@1.9.10
npm error   solid-js@"^1.9.10" from the root project
npm error   peer solid-js@"^1.6.12" from @solid-primitives/event-bus@1.1.2

npm error Could not resolve dependency:
npm error peer solid-js@"1.9.9" from @opentui/solid@0.1.60
```

### Contributing Factors

1. **Inconsistent npm flags:** The workflow file correctly uses `--legacy-peer-deps` for initial `npm install`, but the release scripts don't use this flag when syncing `package-lock.json`.

2. **Dependency version mismatch:** The project uses `solid-js@1.9.10` but `@opentui/solid@0.1.60` requires exactly `solid-js@1.9.9` as a peer dependency.

3. **Script design:** The release scripts are designed to run `npm install --package-lock-only` to synchronize the lock file after version bumps, but they don't account for the peer dependency conflicts.

## Affected Files

### Scripts That Need Updates

| File | Line | Current Command | Required Fix |
|------|------|-----------------|--------------|
| `scripts/changeset-version.mjs` | 29 | `npm install --package-lock-only` | Add `--legacy-peer-deps` |
| `scripts/instant-version-bump.mjs` | 111 | `cd js && npm install --package-lock-only` | Add `--legacy-peer-deps` |

### Files That Correctly Use the Flag
- `.github/workflows/js.yml` (all `npm install --legacy-peer-deps` commands)

## Solution

### Fix Implementation

Add `--legacy-peer-deps` flag to all `npm install` commands that synchronize `package-lock.json`:

**changeset-version.mjs (line 29):**
```javascript
// Before
await $`npm install --package-lock-only`;

// After
await $`npm install --package-lock-only --legacy-peer-deps`;
```

**instant-version-bump.mjs (line 111):**
```javascript
// Before
await $`cd js && npm install --package-lock-only`;

// After
await $`cd js && npm install --package-lock-only --legacy-peer-deps`;
```

## Verification

After the fix is applied:
1. The Release job should complete successfully
2. The `package-lock.json` should be synchronized without peer dependency errors
3. npm publish should proceed normally

## Lessons Learned

1. **Consistency is key:** When using npm flags like `--legacy-peer-deps`, ensure they are used consistently across all npm install commands in both workflow files and scripts.

2. **Test release workflows:** Release workflows often run in different conditions than regular CI. Test them separately to catch issues like this.

3. **Document npm quirks:** Peer dependency conflicts are common in JavaScript projects. Document the need for `--legacy-peer-deps` in contributing guidelines.

## References

- [GitHub Actions Run #20803315337](https://github.com/link-assistant/agent/actions/runs/20803315337/job/59752415630)
- [CI Run Log (local copy)](./ci-run-20803315337.txt)
- [npm ERESOLVE Documentation](https://docs.npmjs.com/cli/v8/commands/npm-install#strict-peer-deps)
- [Issue #111](https://github.com/link-assistant/agent/issues/111)
