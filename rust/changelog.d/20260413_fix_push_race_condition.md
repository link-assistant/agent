---
bump: patch
---

### Fixed

- Fixed git push race condition in Rust CI/CD auto-release that caused non-fast-forward rejection when JS CI pushed concurrently
- Added fetch/rebase before commit and push retry with pull --rebase (up to 3 attempts)
- Added shared concurrency group (`release-main`) across Rust and JS release jobs to serialize pushes to main
