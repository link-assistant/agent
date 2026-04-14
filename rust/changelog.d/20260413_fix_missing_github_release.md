---
bump: patch
---

### Fixed

- CI/CD: Add recovery mechanism for missing GitHub releases when crate is already published on crates.io
- CI/CD: Improve crates.io publish verification with longer delays (20s) and more retries (5 attempts)
- CI/CD: Check crates.io API before retry attempts to detect successful prior publishes
