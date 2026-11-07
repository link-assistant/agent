# Agent workflow

Read docs/CONTRIBUTING.md and docs/javascript-first.md before changing behavior or CI.

Draft and validate native JavaScript behavior first. Record every incomplete port,
unsupported translation and native adapter; a strict readiness gate must reject
missing or carried behavior before Rust CI starts. Preserve acceptance assertions.

Work in bulk. Workers may edit and test; exactly one coordinator owns git push.
Run required checks for the exact candidate revision, review the whole diff and
push once per batch. Collect every same-revision CI failure before the next batch.
Never let two workers push the same branch. Merge, release and deployment require
the authorization applicable to those separate actions.

Use bounded builds and compatible shared caches. Do not delete user-owned target
directories, dependencies or caches without explicit scope authorization.
