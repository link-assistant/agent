# Case Study: Self-healing release pipeline for unreleased changes

**Issue:** [#36](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/36)
**Source:** [link-assistant/web-capture#56](https://github.com/link-assistant/web-capture/issues/56)

## Problem Statement

The `release` job in `release.yml` gates publishing entirely on the presence of changeset files in `.changeset/`. If a PR merges to main without a changeset (bugfixes, CI changes, dependency bumps, etc.), the release job silently does nothing, leaving merged fixes unreleased indefinitely.

Users running `npm install <package>` get a stale version that doesn't include merged fixes.

## Root Cause

The release flow in `release.yml` had this dependency chain:

```
check-changesets → (has_changesets == 'true') → version-and-commit → publish
```

If `has_changesets` was `false`, the entire chain was skipped — no version step, no publish, no release. There was no fallback mechanism to detect that the current `package.json` version hadn't been published to npm yet.

Key code path (lines 390–409 before fix):

```yaml
- name: Check for changesets
  id: check_changesets
  run: node scripts/check-changesets.mjs

- name: Version packages and commit to main
  if: steps.check_changesets.outputs.has_changesets == 'true'
  id: version
  run: node scripts/version-and-commit.mjs --mode changeset

- name: Publish to npm
  if: steps.version.outputs.version_committed == 'true' || steps.version.outputs.already_released == 'true'
  id: publish
  run: node scripts/publish-to-npm.mjs --should-pull
```

No changesets → `version` step skipped → `version_committed` never set → `publish` step skipped → no release.

## Impact

This issue was documented in [link-assistant/web-capture#56](https://github.com/link-assistant/web-capture/issues/56), where PR #54 merged fixes for Google Docs archive bugs but no release was cut. Users running `cargo install web-capture` continued to get the broken v0.2.0.

The same class of problem affects any project using this template: merged fixes accumulate without being released until someone manually creates a changeset or triggers a manual release.

## Timeline

1. Template release pipeline designed with changeset-only gating
2. PRs merged to main without changesets (bugfixes, CI changes)
3. Release job ran but published nothing — no error, no warning
4. [web-capture#56](https://github.com/link-assistant/web-capture/issues/56) filed documenting the downstream impact
5. [This issue (#36)](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/36) filed to add self-healing mechanism

## Comparison with Rust Template

The [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template) already solved this via `scripts/check-release-needed.rs`, which:

1. Checks crates.io (not just local state) to see if the current version is published
2. If the version isn't published, sets `should_release=true` and `skip_bump=true`
3. The workflow then proceeds to publish without requiring changelog fragments

## Solution

### 1. New script: `check-release-needed.mjs`

Created `scripts/check-release-needed.mjs` (analogous to the Rust template's `check-release-needed.rs`) that:

1. Accepts `HAS_CHANGESETS` environment variable from `check-changesets.mjs`
2. If changesets exist → `should_release=true`, `skip_bump=false` (normal flow)
3. If no changesets → checks npm registry for the current `package.json` version
4. If version not published → `should_release=true`, `skip_bump=true` (self-healing)
5. If version already published → `should_release=false` (no action needed)

### 2. Updated workflow: `release.yml`

Added `check-release-needed.mjs` step between `check-changesets` and the merge/version steps. The publish step condition now includes the self-healing path:

```yaml
- name: Publish to npm
  if: >-
    steps.version.outputs.version_committed == 'true' ||
    steps.version.outputs.already_released == 'true' ||
    (steps.check_release.outputs.should_release == 'true' && steps.check_release.outputs.skip_bump == 'true')
```

This third condition (`should_release && skip_bump`) is the self-healing path: it publishes the current version directly when it's not yet on npm, without requiring a changeset or version bump.

## Key Design Decisions

1. **Check npm, not git tags** — npm is the source of truth for whether users can install a version. Git tags can exist without a published package.

2. **No automatic version bumping** — The self-healing path publishes the current `package.json` version as-is. If the version is already bumped (e.g., via a previous changeset that was consumed but publish failed), this catches it. This is simpler and safer than auto-bumping.

3. **Minimal workflow changes** — The existing changeset flow is untouched. The new step only adds a parallel path for the edge case where no changesets exist but the version is unpublished.
