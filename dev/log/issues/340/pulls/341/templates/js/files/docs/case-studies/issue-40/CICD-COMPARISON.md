# CI/CD Comparison for Issue #40

This comparison covers the GitHub workflow and CI/CD script files requested in issue #40. Full snapshots are stored in `data/js-cicd-files.txt`, `data/rust-cicd-files.txt`, `data/js-template-file-tree.txt`, and `data/rust-template-file-tree.txt`.

Rust template snapshot: `353d89396fd420339f2dab0e548ca2caf6198cd5`.

## File Inventory

### JavaScript Template

| Area                   | Files                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflows              | `.github/workflows/release.yml`, `.github/workflows/links.yml`                                                                                                                                                                                       |
| Runtime/package config | `package.json`, `package-lock.json`, `deno.json`, `bunfig.toml`, `eslint.config.js`                                                                                                                                                                  |
| Release scripts        | `create-github-release.mjs`, `format-github-release.mjs`, `format-release-notes.mjs`, `version-and-commit.mjs`, `instant-version-bump.mjs`, `publish-to-npm.mjs`, `setup-npm.mjs`, `changeset-version.mjs`, `merge-changesets.mjs`                   |
| CI guard scripts       | `detect-code-changes.mjs`, `check-changesets.mjs`, `validate-changeset.mjs`, `check-version.mjs`, `check-release-needed.mjs`, `check-file-line-limits.sh`, `check-mjs-syntax.sh`, `simulate-fresh-merge.sh`, `check-web-archive.mjs`, `js-paths.mjs` |

### Rust Template

| Area                   | Files                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflows              | `.github/workflows/release.yml`                                                                                                                                                          |
| Runtime/package config | `Cargo.toml`, `Cargo.lock`                                                                                                                                                               |
| Release scripts        | `create-github-release.rs`, `version-and-commit.rs`, `bump-version.rs`, `publish-crate.rs`, `collect-changelog.rs`, `create-changelog-fragment.rs`, `get-bump-type.rs`, `get-version.rs` |
| CI guard scripts       | `detect-code-changes.rs`, `check-changelog-fragment.rs`, `check-version-modification.rs`, `check-release-needed.rs`, `check-file-size.rs`, `git-config.rs`, `rust-paths.rs`              |

## Issue-Specific Badge Behavior

| Template   | Release tag support                                                                                        | Badge construction                                                                                                               | Issue #40 status                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| JavaScript | `format-github-release.mjs` supports `--tag-prefix` and passes the full tag to `format-release-notes.mjs`. | Before this PR, `format-release-notes.mjs` interpolated the full tag into `https://img.shields.io/badge/npm-<version>-blue.svg`. | Affected. Fixed by normalizing tag suffixes and escaping static badge path text. |
| Rust       | `create-github-release.rs` supports `--tag-prefix` and creates tags such as `rust-v<version>`.             | Uses dynamic `https://img.shields.io/crates/v/<crate>?label=crates.io` and docs.rs badges.                                       | Not affected. No upstream Rust issue needed.                                     |

## Best Practices Already Shared

| Practice                                     | JavaScript template                             | Rust template                         | Notes                                                                                                    |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Detect changes before running expensive jobs | Yes                                             | Yes                                   | Both templates skip irrelevant jobs by file category.                                                    |
| Version modification guard                   | Yes, `check-version.mjs`                        | Yes, `check-version-modification.rs`  | Both prevent manual version edits in PRs.                                                                |
| Required release metadata check              | Yes, changesets                                 | Yes, changelog fragments              | Language-specific implementation, same intent.                                                           |
| Cross-platform testing                       | Node, Bun, and Deno on Ubuntu, macOS, Windows   | Cargo tests on Ubuntu, macOS, Windows | JS matrix is broader because the package supports multiple JS runtimes.                                  |
| Fast feedback before full test matrix        | Yes                                             | Yes                                   | JS has explicit syntax and file-line checks before the matrix. Rust runs lint and formatting separately. |
| File size guard                              | Yes, 1500-line script/workflow limit            | Yes, Rust file size script            | Both include maintainability gates.                                                                      |
| Package registry as source of truth          | npm-oriented release scripts                    | crates.io-oriented release scripts    | Rust template explicitly checks crates.io before assuming a release exists.                              |
| Release branch concurrency                   | Cancels older runs on `main`, queues PR updates | Cancels in progress for all refs      | JS PR queuing keeps checks stable during force pushes; Rust favors latest-only feedback.                 |
| Link checking                                | Separate `links.yml` with Web Archive fallback  | Not present in snapshot               | JS template has stronger documentation link validation.                                                  |

## Differences That Are Intentional

| Difference                                                                            | Reason                                                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| JS uses changesets; Rust uses changelog fragments                                     | Matches ecosystem conventions and existing template design.                                                     |
| JS publishes to npm with trusted publishing; Rust publishes to crates.io              | Registry-specific authentication and publication flows differ.                                                  |
| JS has `format-release-notes.mjs`; Rust formats release notes during release creation | JS needs a post-release formatter because npm badge insertion happens after the GitHub release exists.          |
| Rust uses dynamic crates.io badges; JS used static npm badges                         | Dynamic npm badges are possible, but the current JS formatter intentionally links to the exact package version. |

## Gaps and Follow-Up Options

| Observation                                                                                  | Recommendation                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Static badge generation is easy to regress when tag text contains path separator characters. | Keep `tests/release-badge.test.js` and reuse `format-release-notes-helpers.mjs` for any future badge paths.                                    |
| JS release formatter previously mixed tag identity and package version display text.         | Keep tag lookup in `format-github-release.mjs`, but normalize before registry badge/link generation.                                           |
| Rust template has no separate link-check workflow in this snapshot.                          | Consider a Rust-template issue only if documentation link checking becomes a requirement there. It is unrelated to issue #40.                  |
| JS workflow has no `timeout-minutes` on jobs.                                                | Consider a separate hardening issue to add job-level timeouts across templates. This PR keeps scope to the badge bug and requested case study. |
| Dynamic npm badge endpoint could avoid static path escaping.                                 | Consider only if release notes should show the latest npm version rather than the exact release version.                                       |

## Conclusion

The same issue was found only in the JavaScript template. The Rust template's badge construction avoids the static badge path form that failed here. The fix in this PR brings the JS formatter up to the same robustness level for prefixed release tags while preserving exact npm-version badge links.
