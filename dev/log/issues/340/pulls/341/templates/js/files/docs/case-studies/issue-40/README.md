# Case Study: Issue #40 - Shields Badge URL Breaks With Prefixed Release Tags

**Issue:** [#40](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/40)
**Pull request:** [#43](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/43)
**Date:** 2026-05-01
**Status:** Fixed in this PR

## Executive Summary

The release formatter used the full Git tag as the message segment in a shields.io static badge URL. After issue #38 added support for language-prefixed tags such as `js-v1.7.12`, `scripts/format-github-release.mjs` passed that full tag into `scripts/format-release-notes.mjs`. The formatter only removed a leading `v`, so the generated URL became `https://img.shields.io/badge/npm-js-v1.7.12-blue.svg`.

shields.io static badges parse path segments as dash-separated `label-message-color`. The extra dashes in `js-v1.7.12` changed the path shape and shields.io returned a `404: badge not found` SVG.

This PR fixes the release formatter by normalizing prefixed tags to a bare semantic version before building the badge, and by escaping hyphens in the static badge path so prerelease versions such as `js-v1.0.0-alpha.1` are also safe.

## Data Captured

All investigation artifacts are stored in this directory:

| File                                                | Purpose                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `data/issue-40.json`                                | Full issue metadata and comments for this repository                |
| `data/pr-43.json`                                   | PR metadata and status checks before this fix                       |
| `data/ci-runs-branch.json`                          | Recent CI runs for branch `issue-40-712d252c6da1`                   |
| `data/ci-run-25212337438.json`                      | Metadata for the initial PR CI run                                  |
| `ci-logs/checks-and-release-25212337438.log`        | Downloaded log for the initial PR CI run                            |
| `data/downstream-web-capture-issue-98.json`         | Downstream bug report that exposed the issue                        |
| `data/downstream-web-capture-pr-99.json`            | Downstream fix PR metadata                                          |
| `data/downstream-web-capture-pr-99.diff`            | Downstream fix diff for comparison                                  |
| `data/shields-broken-prefixed-badge.svg`            | Live shields.io response for the broken prefixed badge URL          |
| `data/shields-working-normalized-badge.svg`         | Live shields.io response for the normalized badge URL               |
| `data/shields-broken-prefixed-prerelease-badge.svg` | Live shields.io response for a broken prefixed prerelease badge URL |
| `data/shields-working-prerelease-badge.svg`         | Live shields.io response for the escaped prerelease badge URL       |
| `data/js-template-file-tree.txt`                    | Full file tree snapshot for this JS template                        |
| `data/js-cicd-files.txt`                            | JS template CI/CD and script file list                              |
| `data/rust-template-file-tree.txt`                  | Full file tree snapshot for the Rust template                       |
| `data/rust-cicd-files.txt`                          | Rust template CI/CD and script file list                            |
| `rust-template/release.yml`                         | Rust template release workflow snapshot                             |
| `rust-template/create-github-release.rs`            | Rust template release creation script snapshot                      |

## Timeline

| Time                 | Event                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-20 14:07 UTC | JS template PR [#39](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/39) merged `--tag-prefix` support for multi-language repositories.                    |
| 2026-04-21 11:07 UTC | Downstream issue [link-assistant/web-capture#98](https://github.com/link-assistant/web-capture/issues/98) reported the broken JS release badge for tag `js-v1.7.12`.                          |
| 2026-04-21 11:08 UTC | Downstream PR [link-assistant/web-capture#99](https://github.com/link-assistant/web-capture/pull/99) opened with a local normalization fix and release body repair script.                    |
| 2026-04-21 11:21 UTC | Template issue [#40](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/40) opened to fix the latent template bug.                                          |
| 2026-05-01 11:12 UTC | Issue comment requested complete CI/CD comparison, data capture, and case study documentation.                                                                                                |
| 2026-05-01 11:13 UTC | Initial PR run [25212337438](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/25212337438) completed successfully for the placeholder branch state. |
| 2026-05-01           | This PR added the regression test, fixed the formatter, captured supporting data, and documented the comparison.                                                                              |

## Requirements

| Requirement                                                                      | Source                  | Resolution                                                                                                                                 |
| -------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Fix broken shields.io npm badge when release version contains `js-v` or `rust-v` | Issue #40 body          | Implemented in `scripts/format-release-notes-helpers.mjs` and wired into `scripts/format-release-notes.mjs`.                               |
| Preserve backward compatibility for plain `v<version>` tags                      | Issue #40 suggested fix | Added tests for `v1.7.12` and prefixed tags.                                                                                               |
| Compare CI/CD workflow and script files against the Rust template                | Issue #40 comment       | Added `CICD-COMPARISON.md` and captured both file lists plus Rust snapshots.                                                               |
| Download logs and related data under `docs/case-studies/issue-40`                | Issue #40 comment       | Captured issue, PR, CI, downstream, SVG, and template comparison data.                                                                     |
| Reconstruct timeline, requirements, root causes, and solution plan               | Issue #40 comment       | Documented in this case study.                                                                                                             |
| Search online for supporting facts                                               | Issue #40 comment       | Used shields.io static badge documentation and live shields.io responses.                                                                  |
| Report the same issue in related templates if found                              | Issue #40 comment       | Rust template was checked; it uses dynamic `crates/v/<crate>` badges and does not have this static npm badge bug. No Rust issue was filed. |
| Add debug output if root cause cannot be determined                              | Issue #40 comment       | Not needed. The live SVG response and code path fully reproduce the root cause.                                                            |

## Reproduction Evidence

Broken prefixed URL:

```sh
curl -sS 'https://img.shields.io/badge/npm-js-v1.7.12-blue.svg' | head -c 200
```

Captured response: `data/shields-broken-prefixed-badge.svg`.

Observed SVG title: `404: badge not found`.

Working normalized URL:

```sh
curl -sS 'https://img.shields.io/badge/npm-1.7.12-blue.svg' | head -c 200
```

Captured response: `data/shields-working-normalized-badge.svg`.

Observed SVG title: `npm: 1.7.12`.

## Root Cause Analysis

### Root Cause 1: Static badge URL received a tag instead of a display version

`scripts/format-github-release.mjs` constructs the GitHub release tag as `${tagPrefix}${version}` and passes that tag as `--release-version` to `scripts/format-release-notes.mjs`.

For multi-language repositories this is correct for finding the GitHub release, but it is not the correct value for an npm version badge message.

### Root Cause 2: Formatter only stripped a leading `v`

The old code used:

```js
const versionWithoutV = version.replace(/^v/, '');
```

Given `js-v1.7.12`, that expression returns `js-v1.7.12`. The generated static badge path has too many dash-delimited segments:

```text
/badge/npm-js-v1.7.12-blue.svg
```

shields.io static badge documentation defines the path as dash-separated label, message, and color. It also documents double dash as the way to encode a literal dash in badge text.

### Root Cause 3: Tests covered tag construction but not badge construction

`tests/tag-prefix.test.js` verified that `js-v` and `rust-v` tags are constructed correctly. It did not verify that the release note formatter converts those tags back to registry versions before building badge URLs.

## Solution Applied

1. Added `scripts/format-release-notes-helpers.mjs` with pure helper functions for badge-safe version handling.
2. Extracted the semantic version suffix from tags such as `v1.7.12`, `js-v1.7.12`, and `rust-v0.3.4`.
3. Escaped shields.io static badge message text with documented path escaping, including `-` to `--`.
4. Updated `scripts/format-release-notes.mjs` to use the helper instead of inline `version.replace(/^v/, '')`.
5. Added `tests/release-badge.test.js` covering plain tags, prefixed tags, and prefixed prerelease tags.
6. Added a patch changeset for the code change.

## Alternatives Considered

| Option                                                                       | Tradeoff                                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Normalize the passed release tag before building the static badge            | Chosen. Minimal behavior change, keeps links pointing at the exact npm version page, and matches downstream PR #99.  |
| Use shields.io dynamic npm endpoint `https://img.shields.io/npm/v/<package>` | Avoids static badge escaping, but shows the current npm version rather than necessarily the release being formatted. |
| Pass a clean numeric version from the caller                                 | Also valid, but the formatter should still be robust when called directly with a prefixed tag.                       |
| Add a badge-builder dependency                                               | Unnecessary for the small amount of path escaping needed here.                                                       |

## Rust Template Check

The Rust template does not have the same bug. Its release script builds badges with:

```text
https://img.shields.io/crates/v/<crate>?label=crates.io
```

The version is not interpolated into a static `/badge/<label>-<message>-<color>` path. The Rust release tag can still be `rust-v<version>`, but the badge uses the crate name and crates.io dynamic endpoint, so there is no extra dash-separated message segment to break.

## Verification

Automated regression test:

```sh
node --test tests/release-badge.test.js
```

Expected behavior covered by tests:

- `v1.7.12` normalizes to `1.7.12`.
- `js-v1.7.12` normalizes to `1.7.12`.
- `rust-v0.3.4` normalizes to `0.3.4`.
- `js-v1.0.0-alpha.1` produces `/badge/npm-1.0.0--alpha.1-blue.svg`.

## References

- [Issue #40](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/40)
- [PR #43](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/43)
- [Downstream issue link-assistant/web-capture#98](https://github.com/link-assistant/web-capture/issues/98)
- [Downstream fix link-assistant/web-capture#99](https://github.com/link-assistant/web-capture/pull/99)
- [Rust template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)
- [shields.io static badge documentation](https://shields.io/badges/static-badge)
- [shields.io npm version badge documentation](https://shields.io/badges/npm-version)
