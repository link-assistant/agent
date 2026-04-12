---
'@link-assistant/agent': patch
---

fix: update create-github-release.mjs to support both JS and Rust changelog formats (#247)

- Fixed changelog version regex to handle Rust's `## [version] - date` format alongside JS's `## version` format
- Previously the regex would fail to extract release notes for Rust releases due to unescaped `[` brackets and dots
