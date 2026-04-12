---
bump: minor
---

### Changed

- Renamed crate from `agent` to `link-assistant-agent` on crates.io to avoid name conflict with existing `agent` crate
- Binary name remains `agent` for user convenience (`cargo install link-assistant-agent` installs the `agent` binary)

### Fixed

- CI/CD pipeline now publishes to crates.io before creating GitHub releases, preventing false positive releases
- GitHub release is only created after successful crates.io publish (matching the JS pipeline behavior)

### Added

- Crates.io badge added to root README under Rust Implementation section
