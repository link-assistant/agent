---
'@link-assistant/agent': patch
---

Fix a crash in git worktrees and submodules: project detection wrote its id cache to `.git/opencode` while `.git` is a file there, and the unhandled ENOTDIR rejection made the CLI exit with `UnhandledRejection`. The id is now cached in the common git directory (as upstream does) and a failed cache write is only logged.
