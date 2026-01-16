---
'@link-assistant/agent': patch
---

Fix shields.io badge URL in GitHub release notes

- Fixed badge URL generation that was broken by tag prefixes (js-, rust-)
- The `format-github-release.mjs` script now passes `v${version}` instead of the full tag
- This ensures the badge URL contains only the version number (e.g., `0.8.4`) without prefix
- See `docs/case-studies/issue-123` for detailed root cause analysis

Fixes #123
