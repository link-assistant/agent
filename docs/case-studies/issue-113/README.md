# Case Study: Issue #113 - JavaScript Publish Does Not Work

## Summary

The JavaScript CI/CD pipeline was failing during the release step due to a subtle bug related to how the `command-stream` library handles the `cd` command.

## Timeline of Events

1. **CI Run Triggered**: Push to main branch triggered the JS CI/CD Pipeline (run #20885464993)
2. **Tests Passed**: Lint, format check, and unit tests all passed successfully
3. **Release Job Started**: The release job started and began processing changesets
4. **Version Bump Executed**: The `version-and-commit.mjs` script ran `cd js && npm run changeset:version`
5. **Failure**: After the version bump completed, the script failed with:
   ```
   Error: ENOENT: no such file or directory, open './js/package.json'
   ```

## Root Cause Analysis

### The Bug

The root cause was a subtle interaction between the `command-stream` library and Node.js's process working directory:

1. **command-stream's Virtual `cd` Command**: The `command-stream` library implements `cd` as a **virtual command** that calls `process.chdir()` on the Node.js process itself, rather than just affecting the subprocess.

2. **Working Directory Persistence**: When the script executed:
   ```javascript
   await $`cd js && npm run changeset:version`;
   ```
   The `cd js` command permanently changed the Node.js process's working directory from the repository root to the `js/` subdirectory.

3. **Subsequent File Access Failure**: After the command returned, when the script tried to read `./js/package.json`, it was looking for the file relative to the **new** working directory (`js/`), which would resolve to `js/js/package.json` - a path that doesn't exist.

### Code Flow

```
Repository Root (/)
├── js/
│   └── package.json    <- This is what we want to read
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

### Why This Was Hard to Detect

- The `cd` command in most shell scripts only affects the subprocess, not the parent process
- Developers familiar with Unix shells would not expect `cd` to affect the Node.js process
- The error message didn't clearly indicate that the working directory had changed
- The `command-stream` library documentation doesn't prominently warn about this behavior

## Solution

The fix involves saving the original working directory and restoring it after any command that uses `cd`:

```javascript
// Store the original working directory
const originalCwd = process.cwd();

try {
  // ... code that uses cd ...
  await $`cd js && npm run changeset:version`;

  // Restore the original working directory
  process.chdir(originalCwd);

  // Now file operations work correctly
  const packageJson = JSON.parse(readFileSync('./js/package.json', 'utf8'));
} catch (error) {
  // Handle error
}
```

### Files Modified

1. **scripts/version-and-commit.mjs**: Added cwd preservation and restoration after `cd js && npm run changeset:version`

2. **scripts/instant-version-bump.mjs**: Added cwd preservation and restoration after:
   - `cd js && npm version ${bumpType} --no-git-tag-version`
   - `cd js && npm install --package-lock-only --legacy-peer-deps`

3. **scripts/publish-to-npm.mjs**: Added cwd preservation and restoration after `cd js && npm run changeset:publish`, including proper handling in the retry loop error path

## Lessons Learned

1. **Understand Library Internals**: Third-party libraries may have non-obvious behaviors. The `command-stream` library's virtual `cd` command is a powerful feature for maintaining working directory state, but it can cause issues if not handled properly.

2. **Test Edge Cases**: The CI environment differs from local development. File path handling can behave differently depending on the working directory context.

3. **Add Defensive Code**: When using commands that modify process state, always save and restore the original state.

4. **Document Non-Obvious Behaviors**: The fix includes detailed comments explaining why the `process.chdir()` restoration is necessary.

## CI Logs

The full CI logs are preserved in:
- `ci-logs/full-run-20885464993.log` - Complete run log
- `ci-logs/release-job-60008012717.log` - Detailed release job log

## References

- [GitHub Issue #113](https://github.com/link-assistant/agent/issues/113)
- [CI Run #20885464993](https://github.com/link-assistant/agent/actions/runs/20885464993)
- [command-stream npm package](https://www.npmjs.com/package/command-stream)
