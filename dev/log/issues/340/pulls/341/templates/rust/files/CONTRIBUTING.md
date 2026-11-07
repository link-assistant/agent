# Contributing to rust-ai-driven-development-pipeline-template

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR-USERNAME/rust-ai-driven-development-pipeline-template.git
   cd rust-ai-driven-development-pipeline-template
   ```

2. **Install Rust**

   Install Rust using rustup (if not already installed):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Install development tools**

   ```bash
   rustup component add rustfmt clippy
   ./scripts/install-rust-script.sh
   ```

4. **Install pre-commit hooks** (optional but recommended)

   ```bash
   pip install pre-commit
   pre-commit install
   ```

5. **Build the project**

   ```bash
   cargo build
   ```

## Development Workflow

1. **Create a feature branch**

   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes**

   - Write code following the project's style guidelines
   - Add tests for any new functionality
   - Update documentation as needed

3. **Run quality checks**

   ```bash
   # Format code
   cargo fmt

   # Run Clippy lints
   cargo clippy --all-targets --all-features

   # Deny Cargo's own warnings (RUSTFLAGS only controls rustc warnings)
   bash scripts/check-cargo-warnings.sh

   # Ensure every CI job installs the tools it uses
   rustc scripts/check-workflow-tools.rs -o /tmp/check-workflow-tools
   /tmp/check-workflow-tools

   # Check file sizes (requires rust-script)
   rust-script scripts/check-file-size.rs

   # Run all checks together
   cargo fmt --check && cargo clippy --all-targets --all-features && rust-script scripts/check-file-size.rs
   ```

4. **Run tests**

   ```bash
   # Run all tests
   cargo test

   # Run tests with verbose output
   cargo test --verbose

   # Run doc tests
   cargo test --doc

   # Run a specific test
   cargo test test_name

   # Run the inline test suites of the rust-scripts under scripts/
   ./scripts/test-scripts.sh
   ```

   `cargo test` runs the crate targets and doc tests, but does not run the `#[cfg(test)]`
   suites that live inside `scripts/*.rs`. Run `./scripts/test-scripts.sh` before
   touching anything under `scripts/`; it builds each script as its own test harness
   under the same `RUSTFLAGS: -Dwarnings` the pipeline sets, which is where a helper
   that only `main` reaches shows up as dead code. The `script-tests` job runs the
   same script, including offline Git regressions and mocked registry/link tests,
   and `build` -- and therefore every release -- is gated on it.

   Rust's built-in `cargo test` runner does not provide a portable global per-test timeout, so wrap long-running network, IO, or async tests with explicit test-level deadlines. If a repository adopts `cargo nextest`, configure runner deadlines with options such as `--slow-timeout` and `--leak-timeout`.

   **`timeout-minutes` is a backstop, never the deadline.** GitHub reports a job killed by `timeout-minutes` as `cancelled`, not `failed`. On a pull request that is indistinguishable from a run superseded by `cancel-in-progress`, so a genuine timeout produces no failure anywhere. Long steps therefore own their own deadline:

   ```yaml
   test:
     timeout-minutes: 30            # backstop
     steps:
       - name: Run tests
         env:
           TEST_BUDGET_SECONDS: 900  # <= 70% of the cap
         run: >-
           bash scripts/run-with-budget-warning.sh "$TEST_BUDGET_SECONDS" "Test suite"
           cargo test --all-features
   ```

   `scripts/run-with-budget-warning.sh` warns at 70% of the budget, terminates the command's whole process group when the budget expires, and exits `124` with a `::error` annotation naming the budget -- so the job reports `failure` with a message you can act on. The budget must stay at or below `MAX_BUDGET_SHARE_PERCENT` (70%) of `timeout-minutes`, because the remainder pays for unbudgeted setup: checkout, toolchain install, cache restore. `tests/unit/ci-cd/issue_135.rs` enforces that invariant, so raising a budget means raising `timeout-minutes` too.

5. **Add a changelog fragment**

   For any user-facing changes, create a changelog fragment:

   ```bash
   # Create a new file in changelog.d/
   # Format: YYYYMMDD_HHMMSS_description.md
   touch changelog.d/$(date +%Y%m%d_%H%M%S)_my_change.md
   ```

   Edit the file to document your changes:

   ```markdown
   ### Added
   - Description of new feature

   ### Fixed
   - Description of bug fix
   ```

   **Why fragments?** This prevents merge conflicts in CHANGELOG.md when multiple PRs are open simultaneously.

6. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

   Pre-commit hooks will automatically run and check your code.

7. **Push and create a Pull Request**

   ```bash
   git push origin feature/my-feature
   ```

   Then create a Pull Request on GitHub.

## Code Style Guidelines

This project uses:

- **rustfmt** for code formatting
- **Clippy** for linting with pedantic and nursery lints enabled
- **cargo test** for testing

### Code Standards

- Follow Rust idioms and best practices
- Use documentation comments (`///`) for all public APIs
- Write tests for all new functionality
- Keep functions focused and reasonably sized
- Keep files under 1000 lines
- Use meaningful variable and function names

### Documentation Format

Use Rust documentation comments:

```rust
/// Brief description of the function.
///
/// Longer description if needed.
///
/// # Arguments
///
/// * `arg1` - Description of arg1
/// * `arg2` - Description of arg2
///
/// # Returns
///
/// Description of return value
///
/// # Errors
///
/// Description of when errors are returned
///
/// # Examples
///
/// ```
/// use my_package::example_function;
/// let result = example_function(1, 2);
/// assert_eq!(result, 3);
/// ```
pub fn example_function(arg1: i32, arg2: i32) -> i32 {
    arg1 + arg2
}
```

## Testing Guidelines

- Write tests for all new features
- Maintain or improve test coverage
- Use descriptive test names
- Organize tests in modules when appropriate
- Use `#[cfg(test)]` for test-only code

Example test structure:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    mod my_feature_tests {
        use super::*;

        #[test]
        fn test_basic_functionality() {
            assert_eq!(my_function(), expected_result);
        }

        #[test]
        fn test_edge_case() {
            assert_eq!(my_function(edge_case_input), expected_result);
        }
    }
}
```

## Pull Request Process

1. Ensure all tests pass locally
2. Update documentation if needed
3. Add a changelog fragment (see step 5 in Development Workflow)
4. Ensure the PR description clearly describes the changes
5. Link any related issues in the PR description
6. Wait for CI checks to pass
7. Address any review feedback

## Changelog Management

This project uses a fragment-based changelog system similar to [Scriv](https://scriv.readthedocs.io/) (Python) and [Changesets](https://github.com/changesets/changesets) (JavaScript).

### Creating a Fragment

```bash
# Create a new fragment with timestamp
touch changelog.d/$(date +%Y%m%d_%H%M%S)_description.md
```

### Fragment Categories

Use these categories in your fragments:

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Features that will be removed in future
- **Removed**: Features that were removed
- **Fixed**: Bug fixes
- **Security**: Security-related changes

### During Release

Fragments are automatically collected into CHANGELOG.md during the release process. The release workflow:

1. Collects all fragments
2. Updates CHANGELOG.md with the new version entry
3. Removes processed fragment files
4. Bumps the version in Cargo.toml
5. Creates a git tag and GitHub release

## Project Structure

```
.
├── .github/workflows/    # GitHub Actions CI/CD
├── changelog.d/          # Changelog fragments
│   ├── README.md         # Fragment instructions
│   └── *.md              # Individual changelog fragments
├── examples/             # Usage examples
├── scripts/              # Rust scripts (via rust-script)
├── src/
│   ├── lib.rs            # Library entry point
│   └── main.rs           # Binary entry point
├── tests/                # Integration tests
├── .gitignore            # Git ignore patterns
├── .pre-commit-config.yaml  # Pre-commit hooks
├── Cargo.toml            # Project configuration
├── CHANGELOG.md          # Project changelog
├── CONTRIBUTING.md       # This file
├── LICENSE               # Unlicense (public domain)
└── README.md             # Project README
```

## Release Process

This project uses semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

Versions are managed by the release pipeline. To trigger a release:

1. Add a new fragment in `changelog.d/` with its bump type and merge the pull request.
2. Or manually trigger the release workflow with a version bump type.

The writer updates package metadata and consumes fragments after checking the
entire repository for unrelated staged, modified, deleted or untracked files.
It refuses a dirty checkout containing unrelated work and preserves those files.
Do not edit package versions manually in pull requests, including `release/*` branches.

## Getting Help

- Open an issue for bugs or feature requests
- Use discussions for questions and general help
- Check existing issues and PRs before creating new ones

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

Thank you for contributing!

## JavaScript-first mixed-language projects

Follow [the JavaScript-first gate and single push workflow](docs/javascript-first.md) before enabling production Rust jobs for a mixed-language project.
The gate automatically detects production JavaScript counterparts. Tooling and
examples alone do not require a JavaScript port, and Rust-only projects pass
without one. Detected counterparts require real native, strict parity and
regeneration commands before any Rust work.
