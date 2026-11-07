The CI audit in https://github.com/link-assistant/agent/pull/341 found this shared issue in the template at `9b23717502a9f68218f180ce35008b42d8ad50d7`.

Read-only checks in `.github/workflows/release.yml` use `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. On `main` this evaluates to false, so obsolete checks continue consuming runners even after a newer push supersedes them. The current [CI/CD principles](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md#10-concurrency-control) require cancellation for read-only jobs on both PRs and main.

Reproduction:

1. Copy the release workflow from [this snapshot](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/blob/9b23717502a9f68218f180ce35008b42d8ad50d7/.github/workflows/release.yml).
2. Push commit A to `main`, wait for a read-only test/lint job to begin, then push commit B before it completes.
3. A and B have the same per-job concurrency group. A remains running because the condition evaluates to false. Expected: only A's obsolete read-only job is cancelled; B runs and active publishers finish.

A finite local check also reproduces the configuration mismatch:

```sh
rg -n 'cancel-in-progress:.*github.ref' .github/workflows/release.yml
```

Workaround and suggested code fix: set `cancel-in-progress: true` for each `check-...` job (include matrix dimensions in the group); keep all main/publish/deploy writers in one shared repository-scoped group with `cancel-in-progress: false`. Avoid workflow-level cancellation in workflows containing writers. If every pending writer must run, GitHub now supports `queue: max` (requires false cancellation).

Add a regression test that evaluates job concurrency on PR and `refs/heads/main`, asserting checks cancel and writers never cancel. Keep the status gate aware of superseded cancellation so old checks do not create misleading failures. Existing active-writer serialization must remain intact.
