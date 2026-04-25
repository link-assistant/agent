---
bump: patch
---

### Changed

- Move Rust integration tests from `tests/integration_*.rs` flat files into a `tests/integration/` subdirectory, mirroring the JS `js/tests/integration/` structure. Added `[[test]]` entries in `Cargo.toml` so each test file remains its own named binary (`integration_basic`, `integration_verbose_hi`, etc.). Added `tests/integration/_defaults.rs` helper mirroring `js/tests/integration/_defaults.js` for centralized default-model access.
