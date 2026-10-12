---
bump: patch
---

### Fixed

- Use `opencode/big-pickle` by default and remove withdrawn OpenCode Zen models from the default compaction cascade, matching the JavaScript implementation.

### Changed

- Refresh serde_json, tokio, and uuid to their current releases and update the lockfile to satisfy the dependency freshness check.
