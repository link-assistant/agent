# CI Log Excerpts for Issue #255

## Run 24306117175 — v0.8.0 Release (FALSE POSITIVE SUCCESS)

Commit: `b1d0d1d35c24d98f2b8e361ab5af1b23b8108cc3`
Date: 2026-04-12 11:53-11:56 UTC
Result: **SUCCESS** (but crate was NOT published)

### Auto Release Step Sequence

The `##[group]Run` commands show the complete step sequence — note the missing `cargo publish`:

```
3604: ##[group]Run git config user.name "github-actions[bot]"
3613: ##[group]Run node scripts/rust-get-bump-type.mjs
3630: ##[group]Run # Check if there are changelog fragments
3655: ##[group]Run node scripts/rust-version-and-commit.mjs --bump-type "minor"
3675: ##[group]Run CURRENT_VERSION=$(grep -Po '(?<=^version = ")[^"]*' rust/Cargo.toml)
3684: ##[group]Run cargo build --release
4047: ##[group]Run node scripts/create-github-release.mjs      ← NO cargo publish BEFORE this!
4061: ##[group]Run node scripts/format-github-release.mjs
```

### Key Output Lines

```
3622: Fragment 20251230_120000_separate_cicd_pipelines.md: bump=minor
3623: Fragment 20260410_201700_add_temperature_option.md: bump=minor
3624: Fragment 20260411_fix_rust_cicd_releases.md: bump=patch
3626: Determined bump type: minor (from 3 fragment(s))
3654: Found changelog fragments, proceeding with release
3665: Updated Cargo.toml to version 0.8.0
3670: Committed version 0.8.0
3673: Output: version_committed=true
3674: Output: new_version=0.8.0
4045: Compiling agent v0.8.0 (/home/runner/work/agent/agent/rust)
4046: Finished `release` profile [optimized] target(s) in 1m 04s
4060: ✅ Created GitHub release: rust-v0.8.0
```

### Workflow At This Commit

The workflow at commit `b1d0d1d` had NO `cargo publish` step. The `Create GitHub Release`
step was gated on `steps.check.outputs.should_release == 'true'` instead of
`steps.publish.outputs.published == 'true'`.

---

## Run 24307135603 — v0.9.0 Release (FAILURE)

Commit: `62978b113623b26f5afc5323264e06c3a542ffcb`
Date: 2026-04-12 12:49-12:52 UTC
Result: **FAILURE** — cargo publish failed

### Key Output Lines

```
3958: Fragment 20260412_000000_rename_crate_and_fix_publishing.md: bump=minor
3960: Determined bump type: minor (from 1 fragment(s))
3988: Found changelog fragments, proceeding with release
3999: Updated Cargo.toml to version 0.9.0
4002: Committed version 0.9.0
4003: Created tag rust-v0.9.0
4004: Pushed changes and tags
4005: Output: version_committed=true
4006: Output: new_version=0.9.0
```

### The Failure

```
4390: Credential cargo:token get crates-io
4391: error: 1 files in the working directory contain changes that were not yet committed into git:
4393: Cargo.lock
4395: to proceed despite this and include the uncommitted changes, pass the `--allow-dirty` flag
4396: ##[error]Process completed with exit code 101.
```

**Root cause**: `cargo build --release` (run in the workflow after the commit step) modified
`Cargo.lock`, leaving it dirty when `cargo publish` ran.

---

## Run 24322104554 — Latest Push (No Release Needed)

Commit: `cb37cb718314b863fd83ed731213f78ac29e47db`
Date: 2026-04-13 01:55-01:57 UTC
Result: **SUCCESS** (correctly skipped release)

### Key Output Lines

```
3978: Output: has_fragments=false
4003: No changelog fragments and rust-v0.9.0 already released
```

No publish attempted — correctly identified that rust-v0.9.0 tag already exists
and there are no new changelog fragments.

---

## crates.io API Verification

```bash
# link-assistant-agent: NOT on crates.io (never published)
$ curl -s https://crates.io/api/v1/crates/link-assistant-agent | head -1
{"errors":[{"detail":"Not Found"}]}

# agent: Owned by different user (liangshuai), version 0.0.1
$ curl -s https://crates.io/api/v1/crates/agent | jq '.crate.name, .versions[].num'
"agent"
"0.0.1"
```
