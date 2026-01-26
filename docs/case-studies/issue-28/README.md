# Case Study: Issue #28 - ES Module Syntax Error in .mjs Scripts

## Executive Summary

**Issue**: CI pipeline failed with `ReferenceError: require is not defined in ES module scope` error
**Root Cause**: Mixed CommonJS and ES module syntax in `.mjs` files
**Impact**: Complete CI pipeline failure preventing model testing workflow
**Resolution Time**: Immediate (single commit fix)
**Severity**: High (blocking CI)

## Issue Details

- **GitHub Issue**: [#28](https://github.com/link-assistant/agent/issues/28)
- **Title**: "Our scripts are .mjs, not .cjs"
- **Failed CI Run**: https://github.com/link-assistant/agent/actions/runs/20117079839/job/57728956979
- **Branch**: `issue-28-227b62c91030`
- **Pull Request**: [#29](https://github.com/link-assistant/agent/pull/29)

## Timeline and Sequence of Events

### Event 1: Initial Feature Implementation (PR #27)

**Date**: December 10, 2025
**Commit**: 96dc619 - "feat: Add Groq provider support with documentation and model testing workflow"

- Developer added Groq provider support
- Created initial shell scripts in `experiments/` folder:
  - `experiments/test-groq-simple.sh`
  - `experiments/test-groq-tools.sh`
- These shell scripts worked correctly with bash syntax

### Event 2: Cross-Platform Refactoring (Commit 91f1022)

**Date**: December 10, 2025, 23:26 CET
**Commit**: 91f1022 - "refactor: Replace shell scripts with cross-platform .mjs scripts in workflow"

**What happened**:

- Developer converted shell scripts to Node.js `.mjs` (ES module) files for cross-platform compatibility
- Created three new scripts:
  - `scripts/test-model-simple.mjs`
  - `scripts/test-model-tools.mjs`
  - `scripts/get-model-info.mjs`
- Updated GitHub Actions workflow to use new scripts
- Removed old shell scripts from `experiments/` folder

**The Bug**:
In both `test-model-simple.mjs` and `test-model-tools.mjs`, the developer:

- Correctly imported some Node.js modules using ES6 syntax (line 8-11):
  ```javascript
  import { spawn } from 'child_process';
  import { writeFileSync, readFileSync } from 'fs';
  import { fileURLToPath } from 'url';
  import { dirname, join } from 'path';
  ```
- But **forgot** to import `createWriteStream` from 'fs'
- Left a CommonJS `require()` call on line 46:
  ```javascript
  const logStream = require('fs').createWriteStream(logFile);
  ```

This mixed syntax is incompatible because `.mjs` files are **always** treated as ES modules in Node.js.

### Event 3: Commit Merged to Main

**Date**: December 10, 2025
**Commit**: a9a2cab - "Merge pull request #27 from link-assistant/issue-26-1a4b69adfb64"

- The bug was merged into the main branch
- No CI checks caught the error before merge

### Event 4: CI Failure Detected

**Date**: December 10, 2025, 23:53 UTC
**Run ID**: 20117079839

The model testing workflow ran and failed with:

```
ReferenceError: require is not defined in ES module scope, you can use import instead
    at file:///home/runner/work/agent/agent/scripts/test-model-simple.mjs:46:19
```

### Event 5: Issue Created

**Date**: December 11, 2025
**Issue**: [#28](https://github.com/link-assistant/agent/issues/28)

User reported: "Our scripts are .mjs, not .cjs" with link to failed CI run.

### Event 6: Resolution

**Date**: December 11, 2025
**Commit**: bc94206 - "fix: Replace require() with ES module import in .mjs scripts"

Fixed both files by:

1. Adding `createWriteStream` to the fs import statement
2. Removing the `require('fs')` call
3. Using the imported `createWriteStream` function directly

## Root Cause Analysis

### Technical Root Cause

**Primary Issue**: Incomplete migration from CommonJS to ES modules

The developer was in the process of converting shell scripts to cross-platform Node.js scripts and chose to use `.mjs` extension to explicitly mark them as ES modules. However, they:

1. **Correctly identified** that ES modules require `import` statements
2. **Partially migrated** the code by importing most required functions
3. **Overlooked** one usage of `fs.createWriteStream()` on line 46
4. **Left** a CommonJS `require()` call that worked during local testing (if any) but failed in CI

### Why .mjs Files Reject require()

According to Node.js documentation and best practices:

- **`.mjs` extension**: Explicitly marks a file as an ES module, regardless of package.json settings
- **ES modules**: Do not have access to CommonJS globals like `require`, `module`, `exports`, `__dirname`, or `__filename`
- **Node.js behavior**: When it encounters `require()` in a `.mjs` file, it immediately throws `ReferenceError: require is not defined in ES module scope`

### Contributing Factors

1. **Incomplete code review**: The mixed syntax wasn't caught during PR review
2. **Missing pre-merge CI**: The workflow that would have caught this error didn't run before merge
3. **Manual testing gaps**: The scripts may not have been manually tested before pushing
4. **IDE configuration**: Developer's IDE may not have highlighted the syntax error

## Technical Analysis

### Understanding the Error

From the [Node.js ES modules documentation](https://nodejs.org/api/esm.html):

> Files ending with .mjs are always loaded as ES modules regardless of the nearest parent package.json

When Node.js encounters CommonJS syntax in an ES module:

```javascript
// This throws ReferenceError in .mjs files
const logStream = require('fs').createWriteStream(logFile);
```

The error message is clear:

```
ReferenceError: require is not defined in ES module scope, you can use import instead
```

### The Fix

Replace the CommonJS syntax with proper ES module imports:

**Before** (scripts/test-model-simple.mjs:46):

```javascript
import { writeFileSync, readFileSync } from 'fs';
// ... (35 lines later)
const logStream = require('fs').createWriteStream(logFile);
```

**After** (scripts/test-model-simple.mjs:9,46):

```javascript
import { writeFileSync, readFileSync, createWriteStream } from 'fs';
// ... (35 lines later)
const logStream = createWriteStream(logFile);
```

The same fix was applied to `scripts/test-model-tools.mjs`.

### Verification

Used Node.js syntax checking to verify the fix:

```bash
$ node --check scripts/test-model-simple.mjs
# (no output = success)

$ node --check scripts/test-model-tools.mjs
# (no output = success)
```

## Prevention Strategies

### Immediate Actions Taken

1. ✅ Fixed both affected files
2. ✅ Verified syntax with `node --check`
3. ✅ Created comprehensive case study documentation

### Recommended Long-term Improvements

#### 1. Pre-commit Hooks

Add a pre-commit hook to check all `.mjs` files for CommonJS syntax:

```bash
# .git/hooks/pre-commit
find scripts -name "*.mjs" -exec node --check {} \;
```

#### 2. CI Pipeline Enhancement

Add a syntax validation step to GitHub Actions workflow before running tests:

```yaml
- name: Validate JavaScript syntax
  run: |
    for file in scripts/*.mjs; do
      node --check "$file"
    done
```

#### 3. ESLint Configuration

Configure ESLint to enforce ES module syntax in `.mjs` files:

```javascript
// .eslintrc.js
module.exports = {
  overrides: [
    {
      files: ['*.mjs'],
      parserOptions: {
        sourceType: 'module',
      },
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'CallExpression[callee.name="require"]',
            message:
              'require() is not allowed in ES modules. Use import instead.',
          },
        ],
      },
    },
  ],
};
```

#### 4. Documentation

Add a developer guide explaining:

- When to use `.mjs` vs `.cjs` vs `.js`
- ES module vs CommonJS syntax differences
- Common migration pitfalls

#### 5. IDE Configuration

Recommend IDE settings in a `.vscode/settings.json` file:

```json
{
  "javascript.validate.enable": true,
  "eslint.validate": ["javascript", "javascriptreact", "mjs"]
}
```

## Related Resources

### Understanding the Error

- [Require is not defined in ES module scope (Treehouse Community)](https://teamtreehouse.com/community/require-is-not-defined-in-es-module-scope)
- [ReferenceError: require is not defined in ES module scope (AWS re:Post)](https://repost.aws/questions/QU9hDBbz8OTSWY53n5rdL7Wg/referenceerror-require-is-not-defined-in-es-module-scope-you-can-use-import-instead)
- [How to fix "require is not defined" in JavaScript / Node.js? (CodeDamn)](https://codedamn.com/news/javascript/fix-require-is-not-defined)
- [ReferenceError: require is not defined in JavaScript (bobbyhadz)](https://bobbyhadz.com/blog/javascript-referenceerror-require-is-not-defined)
- [Fixing JavaScript ReferenceError: require is not defined (FavTutor)](https://favtutor.com/articles/require-is-not-defined-javascript/)
- [Why Is Require Not Defined in ES Module Scope? (A Girl Among Geeks)](https://agirlamonggeeks.com/require-is-not-defined-in-es-module-scope/)

### Best Practices (CommonJS vs ES Modules)

- [CommonJS vs. ES Modules (Better Stack Community)](https://betterstack.com/community/guides/scaling-nodejs/commonjs-vs-esm/)
- [CommonJS vs. ES modules in Node.js (LogRocket Blog)](https://blog.logrocket.com/commonjs-vs-es-modules-node-js/)
- [Understanding CommonJS vs. ES Modules in JavaScript (Syncfusion Blogs)](https://www.syncfusion.com/blogs/post/js-commonjs-vs-es-modules)
- [A Deep Dive Into CommonJS and ES Modules in Node.js (AppSignal Blog)](https://blog.appsignal.com/2024/12/11/a-deep-dive-into-commonjs-and-es-modules-in-nodejs.html)
- [CommonJS vs. ES Modules in JavaScript (DeveloperIndian)](https://www.developerindian.com/articles/commonjs-vs-es-modules-in-javascript)
- [How to Mix CommonJS and ES6 Modules in the Same Node.js Project (w3tutorials.net)](https://www.w3tutorials.net/blog/mix-commonjs-and-es6-modules-in-same-project/)
- [Modules: ECMAScript modules (Node.js Documentation)](https://nodejs.org/api/esm.html)
- [Understanding MJS and CJS - JavaScript Modules Explained (RGB Studios)](https://rgbstudios.org/blog/modules-explained-mjs-cjs)
- [CommonJS (cjs) and Modules (esm): Import compatibility (Adam Coster)](https://adamcoster.com/blog/commonjs-and-esm-importexport-compatibility-examples)

## Attachments

- [Failed CI Run Logs](./failed-run-20117079839.log) - Complete logs from the failed GitHub Actions run

## Conclusion

This case demonstrates a common pitfall when migrating from CommonJS to ES modules: incomplete conversion of require() statements to import statements. The fix was straightforward once the root cause was identified, but the incident highlights the importance of:

1. **Thorough code review** for syntax migrations
2. **Automated validation** in CI/CD pipelines
3. **Manual testing** of scripts before pushing
4. **Developer education** on ES modules vs CommonJS

The issue was resolved quickly with a single commit, and this case study provides valuable documentation for preventing similar issues in the future.

---

**Status**: ✅ Resolved
**Fixed in**: Commit bc94206
**Documentation created**: December 11, 2025
