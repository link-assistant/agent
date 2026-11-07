# Issue 196 requirements and validation

Scope: [issue 196](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/196)
and the [automatic detection feedback](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/pull/197#issuecomment-6363996244).
The issue has no comments or required sub-issues. All conversation comments,
inline comments and reviews were read. Router issue 759 is background context;
this PR supplies the reusable Rust-template contract rather than porting Router.

Current main already contains the executable gate and example from PR 216.
Resolve both add/add conflicts by preserving that implementation and every
existing acceptance assertion, then extend it for automatic adoption.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Rust-only projects require no JavaScript port | Detect tracked production JS/TS; exclude tooling, examples, standalone UI/assets and build/dependency trees | `scripts/detect-javascript.test.mjs`, `scripts/javascript-first-auto.test.mjs`; this repository's root bypass |
| Automatically enforce a native counterpart | Source detection works without a package manifest; optional explicit commands or three real package scripts | Root, nested, manifest-free and explicit-example detection tests; mixed example workflow |
| Native checks precede all Rust work | Reusable read-only prerequisite wired into CI, desktop, security and workflow-tool Rust jobs | `experiments/issue-196-workflows.mjs` checks every Rust/toolchain/container job |
| Failed/skipped JavaScript and incomplete parity block Rust | Commands run sequentially and must exit zero; every downstream job requires gate success | Existing gate regressions retained; automatic-gate mutations cover failure/skip exits, missing commands, missing/partial/carried/unsupported entries |
| Regeneration drift fails | Existing pinned typed IR generator and strict inventory retained | Existing stale-source/drift mutations and automatic-gate drift test; example regeneration |
| Exact source revision | SHA verified before/after checks and clean worktree required; downstream event commits are guarded by tested-SHA equality and release tags verify HEAD before execution | Wrong-SHA and untracked-source tests, workflow checkout assertions, clean committed-revision replay |
| Safe candidate provenance | Trusted bootstrap approves event/PR commits or candidates in default-branch history before candidate checkout | `scripts/javascript-first-provenance.test.mjs` refuses arbitrary branch commits in dispatch, scheduled, push and workflow-run cache contexts |
| Generated release candidates are checked | Revalidate after version commit, expose candidate SHA and run reusable candidate gate before image builds | Candidate ordering assertions; image checkout bound to candidate gate; desktop tag resolved to SHA |
| Fresh merges cannot introduce an unchecked counterpart | Re-run detection and prerequisite on simulated merge revision before Cargo | `experiments/issue-196-fresh-merge.mjs`, script ordering assertions and existing integration regressions |
| Writer cannot be cancelled by read-only checks | Preserve job-scoped read-only concurrency and shared non-cancellable queued writer group | Writer concurrency assertions across release and desktop workflows |
| One coordinator and one validated batch push | Root AGENTS, contributor and JavaScript-first guidance retain coordinator policy | Whole-diff review, local checks before push, exact-head CI collection |

Detection is deliberately structural: production JS/TS is a candidate requiring
proof, never proof of parity by itself. Unsupported languages and generated-only
wrappers still need explicit refusal/inventory evidence. Repositories with
unusual source locations can supply explicit commands, which also require the
strict gate. Root scripts must orchestrate all production workspace packages.
No JavaScript port of the root Rust sample is claimed or required.

Plan and completion checks:

1. Read all requirements, guidance and recent related merged PRs; inventory them.
2. Reproduce missing automatic detection and missing downstream wiring in tests.
3. Implement native detection/runner first; retain parity and generation assertions.
4. Integrate exact-SHA dependencies and candidate checks, resolve current main.
5. Run all native, Rust, inline-script and workflow checks under one compiler job;
   retain logs in ignored `ci-logs/`, inspect the whole diff and commit the batch.
6. Replay the committed candidate, push only the prepared branch once, inspect all
   same-revision workflows and download any failing logs before a follow-up batch.
7. Update PR description and closing reference, confirm clean tree/current main,
   all acceptance evidence and passing CI, then mark PR ready without merging.

The first complete CI batch at `290772d` identified two issues, collected before
the follow-up batch: [Windows](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/actions/runs/41066472749)
needed CRLF normalization in the new timeout assertion, and
[CodeQL Actions](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/actions/runs/41066472378)
reported 25 potential cache-poisoning paths through dynamic SHA checkouts.
The follow-up preserves the timeout assertion, adds native provenance refusal
fixtures, guards event pins by tested-SHA equality and verifies release-tag HEADs
before executing code. The SARIF gate and its assertions remain unchanged.
