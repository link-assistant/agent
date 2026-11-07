# Created Issues in Affected Repositories

As requested in the issue comment, we identified all repositories with the same bug and created issues in them.

## Issues Created

1. **link-foundation/test-anywhere**
   - Issue: (creation failed - may already exist or repo may have issues disabled)
   - Script path: scripts/format-release-notes.mjs

2. **link-foundation/gh-download-pull-request**
   - Issue: https://github.com/link-foundation/gh-download-pull-request/issues/5
   - Script path: scripts/format-release-notes.mjs

3. **link-foundation/gh-download-issue**
   - Issue: https://github.com/link-foundation/gh-download-issue/issues/5
   - Script path: scripts/format-release-notes.mjs

4. **link-foundation/js-ai-driven-development-pipeline-template** (this repository)
   - Issue: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/3
   - Script path: scripts/format-release-notes.mjs

## Issue Summary

All issues describe:

- The bug (script only handles Patch changes)
- Current behavior (section headers remain, PR detection fails)
- Expected behavior (clean formatting with PR links)
- Root cause (hardcoded regex pattern)
- Proposed solution (flexible pattern matching)
- Reference to upstream fix (link-assistant/agent#59)
