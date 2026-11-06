# Issue 340 / PR 341 work plan

Objective: address every requirement of issue 340 in PR 341, with evidence and
verification, without merging the pull request.

- [ ] Read the full issue, sub-issues, all three PR comment types and latest feedback.
- [ ] Preserve the eight cited workflow runs, current branch/default branch runs,
      metadata, logs and relevant artifacts; identify exact SHAs and timestamps.
- [ ] Read the CI/CD best practices and compare the complete file trees and every
      workflow/CI script in the JS, Rust and Python templates with this repository.
- [ ] Record the event timeline, exhaustive requirement inventory, root causes,
      online primary-source research, existing components and solution choices.
- [ ] Reproduce each defect with focused tests; implement all applicable fixes
      across workflows/scripts. Add opt-in diagnostics if evidence is insufficient.
- [ ] Report reproduced template/upstream defects with examples, workarounds and
      suggested code fixes, when applicable.
- [ ] Add release triggers required by repository conventions, commit useful
      atomic steps, and push only issue-340-8f7dd340a8ef.
- [ ] Inspect the complete PR diff; merge latest main into this branch if needed;
      run focused checks, then inspect all current-SHA CI runs and preserve logs.
- [ ] Update PR title/body with reproduction, tests, findings and Fixes #340;
      verify a clean worktree and mark PR 341 ready only after required checks pass.

Local constraints: 2.92 GiB total container memory; prefer static checks and small
script tests. Leave full builds/test matrices to CI. Keep experiments bounded and
put reusable probes under experiments/issue-340/.
