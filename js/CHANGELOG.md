# @link-assistant/agent

## 0.8.4

### Patch Changes

- afcd2f8: Fix GitHub release style to match template repository standards
  - Fix release name format to use `[js]` prefix instead of `js ` (e.g., `[js] 0.8.4` instead of `js 0.8.4`)
  - Fix changelog path for js releases to use `js/CHANGELOG.md` instead of root `CHANGELOG.md`
  - This ensures release descriptions contain actual changelog content with PR links and npm badges

  Fixes #121

## 0.8.3

### Patch Changes

- e869df7: Fix DecimalError crash in getUsage() when token data contains objects
  - Add safe() wrapper function to sanitize numeric inputs before Decimal.js
  - Wrap all token calculations with safe() to handle NaN, Infinity, and objects
  - Add try-catch around cost calculation as additional safety measure
  - Add comprehensive unit tests for edge cases

  Fixes #119

## 0.8.2

### Patch Changes

- 4146833: Add language-specific README.md files for JavaScript and Rust implementations
  - Create js/README.md with npm-specific documentation (installation, development, publishing)
  - Create rust/README.md with cargo-specific documentation (build, features, status)
  - Update root README.md to serve as common entry point for both implementations
  - Update package.json files array to include js/README.md for npm package

## 0.8.1

### Patch Changes

- 4f4e6e7: Add publish verification and failure detection to prevent false positives

  The npm publish script now detects failures even when changeset publish exits with code 0. This prevents the CI from falsely reporting success when packages fail to publish.

## 0.8.0

### Minor Changes

- bdb2446: feat: Add Rust CLI implementation with JavaScript reorganization
  - Reorganized JavaScript files from src/ to js/src/ for clearer project structure
  - Moved all JS config files to js/ folder for complete isolation
  - Created separate CI/CD pipelines (js.yml and rust.yml)
  - Created complete Rust implementation of the agent CLI in rust/ folder
  - Added rust/changelog.d/ for Rust changelog fragments
  - Documented lessons learned in docs/case-studies/issue-104/
