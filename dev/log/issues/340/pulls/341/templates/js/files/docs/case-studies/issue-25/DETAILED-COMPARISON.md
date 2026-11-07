# Detailed Comparison: js-ai-driven-development-pipeline-template vs hive-mind

**Date**: 2026-02-14
**Issue**: [#25](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/25)

This document provides a comprehensive comparison of ALL scripts, configurations, and best practices between both repositories.

---

## 1. GitHub Actions Workflow Comparison

### 1.1 Workflow Structure

| Feature        | This Template     | hive-mind                                   | Notes                                      |
| -------------- | ----------------- | ------------------------------------------- | ------------------------------------------ |
| Workflow files | 1 (`release.yml`) | 2 (`release.yml`, `cleanup-test-repos.yml`) | Template is simpler                        |
| Total jobs     | 9                 | 20+                                         | hive-mind has Docker, Helm, and more tests |
| Lines of code  | ~480              | ~2000                                       | hive-mind is more complex                  |

### 1.2 Trigger Configuration

**Both repositories share:**

```yaml
on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      release_mode: ...
      bump_type: ...
      description: ...
```

### 1.3 Concurrency Configuration

| Repository        | Configuration                                                                         |
| ----------------- | ------------------------------------------------------------------------------------- |
| **This Template** | `concurrency: ${{ github.workflow }}-${{ github.ref }}` (no cancel-in-progress)       |
| **hive-mind**     | `concurrency: group: ..., cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}` |

**Finding**: This template should add `cancel-in-progress` for main branch to prevent blocking (Issue #1274).

### 1.4 Job Comparison

| Job                    | This Template     | hive-mind           | Status                               |
| ---------------------- | ----------------- | ------------------- | ------------------------------------ |
| detect-changes         | Yes               | Yes                 | Present                              |
| version-check          | Yes               | Yes                 | Present                              |
| changeset-check        | Yes               | Yes                 | Present                              |
| lint                   | Yes               | Yes                 | Present                              |
| test                   | Yes (matrix: 3x3) | Yes (separate jobs) | Different approach                   |
| test-compilation       | No                | Yes                 | hive-mind has compilation check      |
| check-file-line-limits | No                | Yes                 | Separate job in hive-mind            |
| test-suites            | No                | Yes                 | hive-mind runs extensive test suites |
| test-execution         | No                | Yes                 | hive-mind tests CLI execution        |
| memory-check           | No                | Yes                 | hive-mind validates memory           |
| validate-docs          | No                | Yes                 | hive-mind validates documentation    |
| docker-pr-check        | No                | Yes                 | Not applicable (no Docker)           |
| docker-publish         | No                | Yes                 | Not applicable (no Docker)           |
| helm-pr-check          | No                | Yes                 | Not applicable (no Helm)             |
| helm-release           | No                | Yes                 | Not applicable (no Helm)             |
| release                | Yes               | Yes                 | Present                              |
| instant-release        | Yes               | Yes                 | Present                              |
| changeset-pr           | Yes               | Yes                 | Present                              |

### 1.5 Fresh Merge Simulation

**Both repositories implement fresh merge simulation** in lint and test jobs:

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  run: |
    git fetch origin "$BASE_REF"
    git merge origin/$BASE_REF --no-edit
```

**Finding**: This template correctly implements this pattern.

### 1.6 always() vs !cancelled()

| Repository        | Pattern                                            | Risk                                   |
| ----------------- | -------------------------------------------------- | -------------------------------------- |
| **This Template** | Uses `always()` sparingly                          | Low risk (no long-running Docker jobs) |
| **hive-mind**     | Changed `always()` to `!cancelled()` (Issue #1278) | Required for Docker jobs               |

**Finding**: This template doesn't need this change as it has no Docker/long-running jobs.

---

## 2. Scripts Comparison

### 2.1 Common Scripts (Present in Both)

| Script                        | This Template | hive-mind  | Differences                       |
| ----------------------------- | ------------- | ---------- | --------------------------------- |
| `check-version.mjs`           | 130 lines     | ~100 lines | Nearly identical implementation   |
| `detect-code-changes.mjs`     | 195 lines     | ~130 lines | Template includes more file types |
| `validate-changeset.mjs`      | Present       | Present    | Similar validation logic          |
| `merge-changesets.mjs`        | Present       | Present    | Similar merge logic               |
| `version-and-commit.mjs`      | Present       | Present    | Similar versioning logic          |
| `create-github-release.mjs`   | Present       | Present    | Similar release creation          |
| `format-github-release.mjs`   | Present       | Present    | Similar formatting                |
| `format-release-notes.mjs`    | Present       | Present    | Similar formatting                |
| `publish-to-npm.mjs`          | Present       | Present    | Similar publishing                |
| `setup-npm.mjs`               | Present       | Present    | Identical OIDC setup              |
| `create-manual-changeset.mjs` | Present       | Present    | Similar changeset creation        |
| `instant-version-bump.mjs`    | Present       | Present    | Similar instant bumping           |

### 2.2 Scripts Only in This Template

| Script                  | Purpose                             |
| ----------------------- | ----------------------------------- |
| `changeset-version.mjs` | Custom changeset versioning wrapper |
| `check-changesets.mjs`  | Checks for pending changesets       |
| `js-paths.mjs`          | JavaScript paths utility            |

### 2.3 Scripts Only in hive-mind

| Script                        | Purpose                            | Applicable to Template?         |
| ----------------------------- | ---------------------------------- | ------------------------------- |
| `free-disk-space.mjs`         | Frees disk space for Docker builds | No (no Docker)                  |
| `helm-release.mjs`            | Helm chart release automation      | No (no Helm)                    |
| `upload-sourcemaps.mjs`       | Sentry source map upload           | No (no Sentry)                  |
| `wait-for-npm.mjs`            | Waits for npm package availability | No (no Docker dependent on npm) |
| `ubuntu-24-server-install.sh` | Server setup script                | No (not a server app)           |

---

## 3. ESLint Configuration Comparison

### 3.1 Configuration Structure

| Feature              | This Template            | hive-mind                   |
| -------------------- | ------------------------ | --------------------------- |
| Config file          | `eslint.config.js`       | `eslint.config.mjs`         |
| Base config          | `@eslint/js` recommended | `@eslint/js` recommended    |
| Prettier integration | Yes                      | Yes                         |
| Custom rules         | No                       | Yes (`require-gh-paginate`) |

### 3.2 Rules Comparison

| Rule                              | This Template  | hive-mind          |
| --------------------------------- | -------------- | ------------------ |
| `max-lines`                       | 1500 (error)   | 1500 (error)       |
| `max-lines-per-function`          | 150 (warn)     | Not configured     |
| `max-depth`                       | 5 (warn)       | Not configured     |
| `complexity`                      | 15 (warn)      | Not configured     |
| `max-params`                      | 6 (warn)       | Not configured     |
| `max-statements`                  | 60 (warn)      | Not configured     |
| `eqeqeq`                          | always (error) | Not configured     |
| `curly`                           | all (error)    | Not configured     |
| `no-var`                          | error          | Not configured     |
| `prefer-const`                    | error          | Not configured     |
| `prefer-arrow-callback`           | error          | Not configured     |
| `prefer-template`                 | error          | Not configured     |
| `require-await`                   | warn           | Not configured     |
| `camelcase`                       | Not configured | error              |
| `gh-paginate/require-gh-paginate` | Not applicable | warn (custom rule) |

**Finding**: This template has MORE comprehensive ESLint rules than hive-mind.

### 3.3 Custom ESLint Rule in hive-mind

hive-mind has a custom ESLint rule `require-gh-paginate` that:

- Detects `gh api` calls that return lists
- Warns if `--paginate` flag is missing
- Prevents missing data due to GitHub's 30-result-per-page limit

**Recommendation**: Consider adding this rule if the template will use GitHub API calls.

---

## 4. Package.json Comparison

### 4.1 Scripts Comparison

| Script              | This Template         | hive-mind                                  |
| ------------------- | --------------------- | ------------------------------------------ |
| `test`              | `node --test tests/`  | Multiple test files chained                |
| `lint`              | `eslint .`            | `eslint 'src/**/*.{js,mjs,cjs}'`           |
| `lint:fix`          | `eslint . --fix`      | `eslint 'src/**/*.{js,mjs,cjs}' --fix`     |
| `format`            | `prettier --write .`  | `prettier --write "**/*.{js,mjs,json,md}"` |
| `format:check`      | `prettier --check .`  | `prettier --check "**/*.{js,mjs,json,md}"` |
| `check:duplication` | `jscpd .`             | Not present                                |
| `check`             | Combined check script | Not present                                |
| `prepare`           | `husky \|\| true`     | `husky`                                    |

### 4.2 Dependencies Comparison

| Dependency               | This Template | hive-mind |
| ------------------------ | ------------- | --------- |
| `@changesets/cli`        | Yes           | Yes       |
| `eslint`                 | Yes           | Yes       |
| `eslint-config-prettier` | Yes           | Yes       |
| `eslint-plugin-prettier` | Yes           | Yes       |
| `husky`                  | Yes           | Yes       |
| `prettier`               | Yes           | Yes       |
| `lint-staged`            | Yes           | Yes       |
| `jscpd`                  | Yes           | No        |
| `test-anywhere`          | Yes           | No        |
| `@sentry/node`           | No            | Yes       |
| `@secretlint/*`          | No            | Yes       |
| `dayjs`                  | No            | Yes       |
| `semver`                 | No            | Yes       |

**Finding**: This template has code duplication detection (`jscpd`) which hive-mind doesn't have.

---

## 5. Configuration Files Comparison

### 5.1 Files Present in Both

| File                     | Differences                                          |
| ------------------------ | ---------------------------------------------------- |
| `.changeset/config.json` | Identical configuration                              |
| `.husky/pre-commit`      | Identical (`npx lint-staged`)                        |
| `.prettierrc`            | Template uses `printWidth: 80`, hive-mind uses `999` |
| `package.json`           | Different scripts and dependencies                   |
| `eslint.config.*`        | Different rule sets                                  |

### 5.2 Files Only in This Template

| File             | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `.jscpd.json`    | Code duplication detection configuration |
| `deno.json`      | Deno runtime configuration               |
| `src/index.d.ts` | TypeScript declarations                  |

### 5.3 Files Only in hive-mind

| File                 | Purpose                       | Applicable? |
| -------------------- | ----------------------------- | ----------- |
| `.dockerignore`      | Docker build optimization     | No          |
| `.env.example`       | Environment variable template | Optional    |
| `.gitpod.yml`        | Gitpod configuration          | Optional    |
| `.gitpod.Dockerfile` | Gitpod Docker image           | No          |
| `.prettierignore`    | Prettier ignore patterns      | Optional    |
| `cspell.json`        | Spell checking                | Optional    |
| `Dockerfile`         | Docker image definition       | No          |
| `docker-compose.yml` | Docker Compose config         | No          |
| `eslint-rules/`      | Custom ESLint rules           | Consider    |
| `helm/`              | Helm charts                   | No          |
| `coolify/`           | Coolify deployment            | No          |

---

## 6. Best Practices Unique to This Template

| Practice                       | Description                         | Value                       |
| ------------------------------ | ----------------------------------- | --------------------------- |
| **Code duplication check**     | `jscpd` configured with threshold 0 | Catches copy-paste issues   |
| **Deno support**               | `deno.json` for Deno runtime        | Multi-runtime flexibility   |
| **TypeScript declarations**    | `src/index.d.ts` for type safety    | Better IDE support          |
| **Comprehensive ESLint rules** | Complexity, depth, params limits    | More thorough code quality  |
| **Combined check script**      | `npm run check` runs all checks     | Simplified local validation |
| **3x3 test matrix**            | 3 runtimes x 3 platforms            | Comprehensive coverage      |

---

## 7. Best Practices Unique to hive-mind

| Practice                  | Description                          | Value                        |
| ------------------------- | ------------------------------------ | ---------------------------- |
| **Custom ESLint rule**    | `require-gh-paginate`                | Prevents API pagination bugs |
| **Compilation check**     | `node --check` for syntax validation | Early error detection        |
| **Memory check**          | System resource validation           | Prevents OOM issues          |
| **Docker multi-arch**     | Native ARM64 runners (no QEMU)       | Fast cross-platform builds   |
| **Helm chart automation** | Automated Kubernetes deployment      | Container orchestration      |
| **Source map upload**     | Sentry integration                   | Better error tracking        |
| **Spell checking**        | `cspell.json`                        | Catches typos                |
| **Secretlint**            | Secret detection in code             | Security scanning            |

---

## 8. Summary: Who Has What

### Features This Template Has That hive-mind Doesn't

1. Code duplication detection (jscpd)
2. Comprehensive ESLint complexity rules
3. Deno runtime support with config
4. TypeScript declarations
5. Combined `npm run check` script
6. Test matrix approach (3x3)

### Features hive-mind Has That This Template Doesn't (But Should Consider)

1. `cancel-in-progress` for main branch concurrency
2. Spell checking (cspell)
3. Timeout protection on jobs

### Features hive-mind Has That Are Not Applicable to This Template

1. Docker builds and multi-arch support
2. Helm chart deployment
3. Sentry source map upload
4. Custom `gh api` ESLint rule
5. Memory validation for containers
6. Secretlint (template has no secrets)

---

## 9. Actionable Recommendations

### High Priority

1. **Add `cancel-in-progress` to concurrency**:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

### Medium Priority

2. **Add job timeout protection**:

```yaml
jobs:
  lint:
    timeout-minutes: 10
  test:
    timeout-minutes: 15
```

3. **Consider cspell for spell checking** (optional but helpful)

### Low Priority / Optional

4. **Consider secretlint** if handling sensitive data in future
5. **Consider gitpod.yml** for cloud development

---

## 10. Conclusion

This template repository already implements **most critical best practices** and in some areas (code duplication detection, ESLint complexity rules, multi-runtime testing) exceeds what hive-mind has. The main gap is the `cancel-in-progress` concurrency setting which should be added to prevent workflow blocking on the main branch.

The differences between repositories are largely due to their different purposes:

- **This template**: Lightweight npm package template for AI-driven development
- **hive-mind**: Full-featured AI automation platform with Docker, Helm, and extensive tooling

Both repositories demonstrate excellent CI/CD practices for AI-driven development.
