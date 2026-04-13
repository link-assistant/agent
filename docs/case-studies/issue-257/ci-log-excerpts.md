# CI Log Excerpts for Issue #257

## Run 24328743522 (2026-04-13, commit 33d1d8c — merge of PR #256)

### Job summary

| Job | Conclusion |
|---|---|
| Lint and Format Check | success |
| Test (ubuntu-latest) | success |
| Test (macos-latest) | success |
| Build Package | success |
| **Auto Release** | **failure** |
| Manual Release | skipped |

### Auto Release: Publish to crates.io step

```
##[group]Run node scripts/publish-to-crates.mjs --should-pull
node scripts/publish-to-crates.mjs --should-pull
shell: /usr/bin/bash -e {0}
env:
  CARGO_TERM_COLOR: always
  CARGO_HOME: /home/runner/.cargo
  CARGO_INCREMENTAL: 0
  CARGO_REGISTRY_TOKEN:                          ← EMPTY: secret not set
##[endgroup]
Detected multi-language repository (Cargo.toml in rust/)
Pulling latest changes...
From https://github.com/link-assistant/agent
 * branch            main       -> FETCH_HEAD
   243c7ae..de0c003  main       -> origin/main
Updating 243c7ae..de0c003
Fast-forward
 js/.changeset/fix-rust-publish-verification.md | 5 -----
 js/CHANGELOG.md                                | 6 ++++++
 js/package-lock.json                           | 4 ++--
 js/package.json                                | 2 +-
 4 files changed, 9 insertions(+), 8 deletions(-)
 delete mode 100644 js/.changeset/fix-rust-publish-verification.md
Publishing link-assistant-agent@0.9.1 to crates.io...
Checking if link-assistant-agent@0.9.1 is already on crates.io...
Error: CARGO_REGISTRY_TOKEN environment variable is not set
Crate link-assistant-agent does not exist on crates.io yet (first publish)
##[error]Process completed with exit code 1.
```

## Run 24307135603 (2026-04-12, commit 62978b1 — different failure)

This earlier run also had `CARGO_REGISTRY_TOKEN` empty but failed earlier due to uncommitted `Cargo.lock` changes (fixed in PR #255 by adding `--allow-dirty`):

```
Auto Release  Publish to crates.io  env:
Auto Release  Publish to crates.io    CARGO_REGISTRY_TOKEN:    ← also empty
Auto Release  Publish to crates.io  error: 1 files in the working directory contain changes
                                     that were not yet committed into git:
                                     Cargo.lock
Auto Release  Publish to crates.io  ##[error]Process completed with exit code 101.
```
