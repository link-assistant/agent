---
'@link-assistant/agent': minor
---

feat: Add Rust CLI implementation with JavaScript reorganization

- Reorganized JavaScript files from src/ to js/src/ for clearer project structure
- Moved all JS config files to js/ folder for complete isolation
- Created separate CI/CD pipelines (js.yml and rust.yml)
- Created complete Rust implementation of the agent CLI in rust/ folder
- Added rust/changelog.d/ for Rust changelog fragments
- Documented lessons learned in docs/case-studies/issue-104/
