---
bump: patch
---

### Fixed

- Use `CARGO_TOKEN` (organization-level secret) as fallback when `CARGO_REGISTRY_TOKEN` is not set, fixing crates.io publishing in CI/CD
