---
bump: patch
---

### Fixed

- Fixed false positive success on Rust package publishing (#255)
  - Added `publish-to-crates.mjs` script with retry logic and post-publish verification against the crates.io API
  - CI now verifies the crate actually appeared on crates.io before creating a GitHub release
  - Uses `--allow-dirty` flag to prevent `Cargo.lock` false failures during publishing
