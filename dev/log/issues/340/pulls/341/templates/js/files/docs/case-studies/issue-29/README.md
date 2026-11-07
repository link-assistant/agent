# Case Study: CI/CD Best Practices Alignment with hive-mind

**Issue:** [#29](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/29)
**Source:** [link-assistant/hive-mind](https://github.com/link-assistant/hive-mind) CI/CD best practices

## Problem Statement

The JS AI-driven development pipeline template should incorporate all proven CI/CD best practices from the hive-mind repository. A comprehensive comparison revealed several gaps between the two repositories' CI/CD configurations.

## Gap Analysis

### Practices Already Implemented

| Practice                                              | Status      | Notes                                    |
| ----------------------------------------------------- | ----------- | ---------------------------------------- |
| Change detection (`detect-changes` job)               | Implemented | Gates jobs on relevant file changes      |
| File size limits (ESLint `max-lines: 1500`)           | Implemented | ESLint rule enforced                     |
| Automated code formatting (ESLint + Prettier + Husky) | Implemented | Pre-commit hooks active                  |
| Static analysis & linting                             | Implemented | ESLint with strict rules                 |
| Changeset-based versioning                            | Implemented | @changesets/cli with validation          |
| Pre-commit hooks                                      | Implemented | Husky + lint-staged                      |
| Release automation (OIDC trusted publishing)          | Implemented | npm OIDC + dual trigger modes            |
| Concurrency control                                   | Implemented | Cancel-in-progress on main, queue on PRs |
| Fresh merge simulation                                | Implemented | Inline in lint and test jobs             |
| Version change prohibition                            | Implemented | check-version.mjs blocks manual edits    |
| Broken link checking                                  | Implemented | lychee + Web Archive fallback            |
| Cross-runtime testing (Node.js, Bun, Deno)            | Implemented | 3x3 matrix                               |
| Cross-platform testing (Ubuntu, macOS, Windows)       | Implemented | 3x3 matrix                               |
| Code duplication detection (jscpd)                    | Implemented | Threshold-based checking                 |

### Gaps Identified

| #   | Gap                                       | hive-mind Practice                                                         | Impact                                                            |
| --- | ----------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | No test-compilation job                   | Fast syntax check (`node --check` on all `.mjs` files) runs in ~7s         | Missing fast-fail gate for syntax errors                          |
| 2   | No file line limits CI check              | Separate `check-file-line-limits.sh` checks `.mjs` files AND `release.yml` | ESLint only checks `src/` files; scripts and workflow not checked |
| 3   | No fast-fail job ordering                 | Fast checks gate slow checks to give fastest feedback                      | Slow test matrix runs even when lint fails                        |
| 4   | Uses `always()` instead of `!cancelled()` | Issue #1278: `always()` prevents cancellation propagation                  | Cancelled runs still execute dependent jobs                       |
| 5   | No secrets detection                      | Principle #11: Scan for accidental credential leaks                        | Security risk: secrets could be committed                         |
| 6   | No documentation validation               | Principle #12: Validate docs like code                                     | Docs can drift from actual behavior                               |
| 7   | Inline fresh merge simulation             | hive-mind extracts to `scripts/simulate-fresh-merge.sh`                    | Code duplication across lint and test jobs                        |

## Solutions Implemented

### 1. Test Compilation Job (Fast Syntax Check)

Added `scripts/check-mjs-syntax.sh` and a `test-compilation` job that runs `node --check` on all `.mjs` files. This catches syntax errors in ~7 seconds, before the full test suite runs.

### 2. File Line Limits Check

Added `scripts/check-file-line-limits.sh` and a `check-file-line-limits` job. This enforces the 1500-line limit on `.mjs` files and `release.yml`, complementing the ESLint rule which only covers `src/` files.

### 3. Fast-Fail Job Ordering

Restructured job dependencies so slow checks (test matrix) only run after fast checks (test-compilation, lint, check-file-line-limits) pass. This gives the fastest possible feedback loop for AI solvers.

### 4. Fixed `always()` → `!cancelled()`

Replaced `always()` with `!cancelled()` in test job conditions per hive-mind issue #1278. This ensures that when a workflow run is cancelled, dependent jobs also cancel instead of continuing to run.

### 5. Secrets Detection

Added a `secretlint` step in the lint job using `@secretlint/secretlint-rule-preset-recommend`. This catches accidental credential leaks before code reaches review.

### 6. Documentation Validation

Added a `validate-docs` job that runs when docs change, checking for file size limits and structural requirements in documentation files.

### 7. Extracted Fresh Merge Simulation

Moved the duplicated inline fresh merge simulation to `scripts/simulate-fresh-merge.sh`, reducing duplication across the lint and test jobs.

## References

- [hive-mind CI/CD Best Practices](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md)
- [hive-mind release.yml](https://github.com/link-assistant/hive-mind/blob/main/.github/workflows/release.yml) (~1290 lines)
- [Issue #1274](https://github.com/link-assistant/hive-mind/issues/1274) - Concurrency blocking
- [Issue #1278](https://github.com/link-assistant/hive-mind/issues/1278) - `always()` cancellation prevention
- [Issue #1141](https://github.com/link-assistant/hive-mind/issues/1141) - Stale merge preview
