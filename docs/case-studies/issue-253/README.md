# Case Study: Issue #253 — CI/CD Flow for Rust Publishing Failure

## Summary

The Rust CI/CD pipeline's Auto Release job failed when attempting to publish to crates.io. The `cargo publish` command detected uncommitted changes in `Cargo.lock` and exited with code 101.

**Failed run:** https://github.com/link-assistant/agent/actions/runs/24307135603/job/70970340623

---

## Timeline / Sequence of Events

| Time (UTC) | Event |
|---|---|
| 2026-04-12T12:19:17Z | Merge pull request #252 into main (run 24307135603 triggered) |
| 2026-04-12T12:49:20Z | CI run starts: lint ✓, test ✓, build ✓ |
| 2026-04-12T12:51:08Z | Auto Release job starts |
| 2026-04-12T12:51:08Z | `rust-version-and-commit.mjs` bumps Cargo.toml 0.8.x → 0.9.0, commits CHANGELOG.md + Cargo.toml only |
| 2026-04-12T12:51:09Z | `cargo build --release` updates `Cargo.lock` to reflect new version 0.9.0 |
| 2026-04-12T12:52:10Z | `cargo publish --verbose` detects `Cargo.lock` has uncommitted changes |
| 2026-04-12T12:52:11Z | `cargo publish` exits with error code 101 |
| 2026-04-12T12:52:11Z | Auto Release job fails; GitHub Release and format steps are skipped |

---

## Requirements (from Issue Description)

1. **Primary:** Fix the CI/CD flow for Rust publishing so `cargo publish` succeeds.
2. **Research:** Deep case study analysis with timeline, root causes, and solutions.
3. **Data:** Compile all logs and data to `./docs/case-studies/issue-253/`.
4. **Debugging:** If root cause is unclear, add debug/verbose output to find it.
5. **Upstream reports:** If related to other projects, file issues with reproducible examples.

---

## Root Cause Analysis

### Root Cause: Cargo.lock Not Included in Version Bump Commit

**Location:** `scripts/rust-version-and-commit.mjs`, lines 272–276

```javascript
// Stage files
exec(`git add ${CARGO_TOML}`);
if (existsSync(CHANGELOG_FILE)) {
  exec(`git add ${CHANGELOG_FILE}`);
}
exec(`git add ${CHANGELOG_DIR} || true`);
```

The version bump script stages and commits:
- ✅ `rust/Cargo.toml` (version updated from 0.8.x to 0.9.0)
- ✅ `rust/CHANGELOG.md` (new release entry added)
- ✅ `rust/changelog.d/` (fragment files deleted)
- ❌ `rust/Cargo.lock` — **NOT staged or updated**

### Why Cargo.lock Gets Modified

When `Cargo.toml` is updated with a new version, `Cargo.lock` still references the old version. When `cargo build --release` runs (the next step in the workflow), Cargo detects the mismatch and updates `Cargo.lock` to reflect the new package version.

After `cargo build`, `Cargo.lock` has uncommitted changes. When `cargo publish` runs, it checks the git working tree for cleanliness and rejects publishing when it finds any uncommitted changes.

### Cargo's Safety Check

From [cargo publish documentation](https://doc.rust-lang.org/cargo/commands/cargo-publish.html):

> By default, `cargo publish` will not allow publishing if there are uncommitted changes in the working directory.

The error message:
```
error: 1 files in the working directory contain changes that were not yet committed into git:

Cargo.lock

to proceed despite this and include the uncommitted changes, pass the `--allow-dirty` flag
```

### Evidence from CI Logs

The `chore(rust): release v0.9.0` commit (SHA: `3c23cdb`) only changed:
- `rust/CHANGELOG.md`
- `rust/Cargo.toml`
- `rust/changelog.d/20260412_000000_rename_crate_and_fix_publishing.md` (deleted)

`Cargo.lock` was **not** included in this commit.

---

## Contributing Factors

1. **`cargo build` modifies Cargo.lock**: Cargo always updates `Cargo.lock` when the package version in `Cargo.toml` changes, even if dependencies haven't changed. The version of the package itself is recorded in `Cargo.lock`.

2. **Missing `getCargoLockPath` usage**: The `rust-paths.mjs` module already exports a `getCargoLockPath()` function, but it is not imported or used in `rust-version-and-commit.mjs`.

3. **No explicit `cargo update` or `cargo generate-lockfile` step**: The version commit doesn't regenerate `Cargo.lock` before committing — it only touches `Cargo.toml`.

---

## Alternative Solutions Considered

### Option A: Add `--allow-dirty` to `cargo publish` (Not Recommended)

```yaml
run: |
  cargo publish --verbose --allow-dirty
```

**Pros:** Simple one-line change.  
**Cons:**
- Security risk: may inadvertently publish untracked sensitive files
- Bypasses the safety check rather than fixing the root cause
- [Cargo issue #9398](https://github.com/rust-lang/cargo/issues/9398) notes this can expose sensitive data
- Bad practice: the git tree should be clean before publishing

### Option B: Add `git add Cargo.lock && git commit --amend` After Build (Not Recommended)

Add a step in the workflow after `cargo build` to amend the previous commit.

**Cons:**
- `--amend` can fail if commit was already pushed
- The tag already points to the commit before amend
- Complicated and fragile

### Option C: Regenerate Cargo.lock in Version Bump Script and Include in Commit (Recommended)

In `rust-version-and-commit.mjs`, after updating `Cargo.toml`:
1. Run `cargo generate-lockfile` (or `cargo update --workspace`) to regenerate `Cargo.lock`
2. Stage `Cargo.lock` together with `Cargo.toml` in the same commit

**Pros:**
- Root cause fix: the version commit is fully atomic (Cargo.toml + Cargo.lock + CHANGELOG)
- `cargo build` won't modify `Cargo.lock` because it already matches `Cargo.toml`
- Keeps a clean git history
- No security risks
- Consistent with Rust best practices: commit `Cargo.lock` for binary crates

**Cons:** Requires running `cargo` during the version bump script (adds ~1–2 seconds).

### Option D: Commit Cargo.lock After Build in Workflow (Acceptable Alternative)

In the workflow, after the `Build release` step, add a step:

```yaml
- name: Commit Cargo.lock if modified
  run: |
    if ! git diff --quiet rust/Cargo.lock; then
      git add rust/Cargo.lock
      git commit --amend --no-edit
      git push --force-with-lease
    fi
```

**Cons:** Force-push is required to update the tag, which is risky.

---

## Chosen Fix: Option C

Update `scripts/rust-version-and-commit.mjs` to:
1. Import `getCargoLockPath` from `./rust-paths.mjs`
2. After updating `Cargo.toml`, run `cargo generate-lockfile` in the Rust root directory
3. Stage `Cargo.lock` along with `Cargo.toml` and changelog files in the commit

---

## Files Changed

- `scripts/rust-version-and-commit.mjs` — add `cargo generate-lockfile` call and stage `Cargo.lock`

---

## Related Issues / References

- [cargo publish - The Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-publish.html)
- [cargo issue #3265: cargo build updates Cargo.lock](https://github.com/rust-lang/cargo/issues/3265)
- [cargo issue #9398: --allow-dirty security concern](https://github.com/rust-lang/cargo/issues/9398)
- [Rust Forum: uncommitted changes error](https://users.rust-lang.org/t/error-2-files-in-the-working-directory-contain-changes-that-were-not-yet-committed-into-git/46604)
