# Case Study: Issue #115 - Error was treated as success

## Summary

The npm publish step in the CI/CD pipeline falsely reported success despite `changeset publish` failing with an E404 error. This resulted in a GitHub release being created for a version that was never actually published to npm.

## Timeline of Events

### January 10, 2026 - False Positive Publish

| Time (UTC) | Event |
|------------|-------|
| 23:09:37 | Release job starts |
| 23:09:48 | `publish-to-npm.mjs` script starts |
| 23:09:49 | Git pull completes: "Already up to date" |
| 23:09:49 | Version check: "Current version to publish: 0.8.0" |
| 23:09:50 | npm view returns E404 (version not found - expected) |
| 23:09:50 | "Publish attempt 1 of 3..." |
| 23:09:50 | `npm run changeset:publish` starts |
| 23:09:51 | Changeset info: "Publishing @link-assistant/agent at 0.8.0" |
| 23:09:53 | **ERROR**: "E404 Not Found - PUT https://registry.npmjs.org/@link-assistant%2fagent" |
| 23:09:53 | **ERROR**: "npm error 404 Not Found" |
| 23:09:53 | **ERROR**: "packages failed to publish: @link-assistant/agent@0.8.0" |
| 23:09:53 | **FALSE POSITIVE**: "Published @link-assistant/agent@0.8.0 to npm" |
| 23:09:55 | GitHub release js-v0.8.0 created (for unpublished version) |

### Key Evidence from Logs

```
🦋  error an error occurred while publishing @link-assistant/agent: E404 Not Found
🦋  error npm notice Access token expired or revoked. Please try logging in again.
🦋  error packages failed to publish:
🦋  @link-assistant/agent@0.8.0
✅ Published @link-assistant/agent@0.8.0 to npm
```

The checkmark success message appeared **immediately after** the error message, indicating no retry attempts were made.

## Root Cause Analysis

### Primary Root Cause: `changeset publish` exits with code 0 on failure

The `changeset publish` command exits with code 0 even when packages fail to publish. This is a known issue in the changesets ecosystem:
- [Issue #1621](https://github.com/changesets/changesets/issues/1621): Git tag failure isn't handled
- [Issue #1280](https://github.com/changesets/changesets/issues/1280): Action succeeds but package is never published

### Contributing Factor 1: No output validation

The `publish-to-npm.mjs` script (lines 125-139) only relies on exception handling to detect failures:

```javascript
try {
  await $`npm run changeset:publish`;
  // If no exception, assume success
  setOutput('published', 'true');
  console.log(`✅ Published ${PACKAGE_NAME}@${currentVersion} to npm`);
  return;
} catch (_error) {
  // Only retries if exception is thrown
}
```

### Contributing Factor 2: `command-stream` library behavior

The `command-stream` library used for shell command execution does **not throw exceptions** when commands exit with non-zero codes. Verification test:

```javascript
await $`exit 1`;
console.log("This still executes - no error thrown");
```

This means even if `changeset publish` returned exit code 1, the script would still proceed to print success.

### Contributing Factor 3: No post-publish verification

The script does not verify that the package was actually published to npm after the publish command completes.

## Error Chain Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       NPM Publish Failure                            │
│                 (Token expired/revoked - E404)                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              changeset publish outputs errors                        │
│       "packages failed to publish: @link-assistant/agent"           │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│           changeset publish exits with code 0                        │
│              (Known changeset behavior issue)                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│      publish-to-npm.mjs doesn't check output or exit code           │
│         (command-stream doesn't throw on non-zero codes)            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Script prints success message                       │
│        "✅ Published @link-assistant/agent@0.8.0 to npm"            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              GitHub release created for unpublished version          │
│                       (js-v0.8.0 released)                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Impact

1. **User confusion**: A GitHub release exists for version 0.8.0 that cannot be installed from npm
2. **CI/CD trust**: The "green checkmark" on the CI run is misleading
3. **Manual intervention required**: The underlying issue (expired token) was not surfaced properly

## Solutions

### Immediate Fix: Verify publish success by checking npm registry

After running `changeset publish`, verify the package is actually on npm:

```javascript
// After publish attempt
const verifyResult = await $`npm view "${PACKAGE_NAME}@${currentVersion}" version`.run({
  capture: true,
});

if (verifyResult.code !== 0 || !verifyResult.stdout.includes(currentVersion)) {
  throw new Error(`Verification failed: ${PACKAGE_NAME}@${currentVersion} not found on npm`);
}
```

### Additional Fix: Check for error patterns in output

Capture the output of `changeset publish` and check for failure indicators:

```javascript
const result = await $`npm run changeset:publish`.run({ capture: true });

if (result.stdout.includes('packages failed to publish') ||
    result.stderr.includes('error')) {
  throw new Error('Changeset publish reported failures');
}
```

### Long-term Fix: Use `.run({ capture: true })` with exit code checking

The `command-stream` library returns exit codes when using `.run()`:

```javascript
const result = await $`npm run changeset:publish`.run({ capture: true });

if (result.code !== 0) {
  throw new Error(`Publish failed with exit code ${result.code}`);
}
```

## References

- [GitHub Actions Run #20885793383](https://github.com/link-assistant/agent/actions/runs/20885793383/job/60008806663)
- [CI Run Log (local copy)](./ci-logs/run-20885793383.log)
- [Issue #115](https://github.com/link-assistant/agent/issues/115)
- [Changesets Issue #1621 - Git tag failure isn't handled](https://github.com/changesets/changesets/issues/1621)
- [Changesets Issue #1280 - Action succeeds but package is never published](https://github.com/changesets/changesets/issues/1280)

## Files Affected

| File | Issue | Fix Required |
|------|-------|--------------|
| `scripts/publish-to-npm.mjs` | No output/exit code validation | Add verification and output checking |

## Lessons Learned

1. **Don't trust external tool exit codes**: Tools like `changeset` may exit with 0 even on failure
2. **Verify state changes**: After any publish/deploy operation, verify the expected state change occurred
3. **Parse command output**: Check for error patterns in stdout/stderr, not just exceptions
4. **Defense in depth**: Multiple layers of validation prevent false positives
