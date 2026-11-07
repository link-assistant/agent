The audit in https://github.com/link-assistant/agent/pull/341 found that the Rust template's release helper can adopt source that its CI run never tested.

Pinned source: [version-and-commit.rs at 9b237175](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/blob/9b23717502a9f68218f180ce35008b42d8ad50d7/scripts/version-and-commit.rs#L515). Lines 525–545 fetch and unconditionally rebase onto newer remote commits; lines 733–745 do another unrestricted pull/rebase on a push race. ReleaseIndex validates generated/staged metadata, but cannot prove that newly imported committed source was tested by this run.

Finite reproduction:

1. Create a local bare Git origin and two clones on main at commit A. Use a minimal Cargo.toml and a patch fragment. Record A as the validated source.
2. In the second clone, add src/lib.rs (or change a dependency), commit B and push main.
3. In the release clone still at A, execute the helper's synchronization operations: `git fetch origin main`, `git rev-list --count HEAD..origin/main`, then `git rebase origin/main` when behind.
4. The release checkout now contains B's untested source. The helper continues to compute the version and publish metadata without any source-equivalence check. A non-fast-forward during the later push can trigger the same problem.

The bounded executable Git probe is [template-release-sync.py](https://github.com/link-assistant/agent/blob/issue-340-8f7dd340a8ef/experiments/issue-340/template-release-sync.py). It reproduces the Git/source adoption without compiling the Rust helper or publishing to a registry. Agent also has a real pre-push-race regression that injects a concurrent source change, expects release failure and verifies no version/tag was pushed.

Expected: preserve the validated source/dependency tree, or fail and leave the newer commit's own CI run to release it. Release metadata from a concurrent language release may be synchronized only after manifest/lock equivalence and a metadata path allowlist are verified.

Workaround: fail if origin/main has moved beyond the validated commit; let the newer run release. Suggested code fix: record the validated SHA, compare all incoming paths and normalized manifests/locks before every rebase, reject source/dependency changes, and repeat the guard after any retry. Keep existing classification of rule/auth failures and tag-after-successful-push behavior. Add cases for both initial synchronization and a concurrent source push, alongside a permitted metadata-only race.
