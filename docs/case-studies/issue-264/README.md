# Issue 264 Case Study: PR Branch Changes Were Not Committed

This case study archives and analyzes
<https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1833>, which was created
to solve external issue
<https://github.com/Jhon-Crow/godot-topdown-MVP/issues/1826>.

## Executive Summary

The failure was not caused by GitHub rejecting writes to the pull request
branch. The initial branch push succeeded, the pull request head branch lived in
`konard/Jhon-Crow-godot-topdown-MVP`, the authenticated viewer had `ADMIN`
permission on that fork, and the fork branch was not protected.

The failure was caused by the agent loop failing to reliably turn an already
correct working-tree change into a commit before the final provider failure. The
external logs show repeated auto-restarts for the same modified file,
`scripts/autoload/unlock_manager.gd`, then a model response that described a git
commit using malformed tool-call text instead of actually invoking a tool. The
final run then received an OpenRouter-style provider stream error with code
`524`, but the CLI surfaced a misleading `TypeError: undefined is not an object
(evaluating 'usage.inputTokens.total')` and stopped auto-restart.

This PR adds a targeted runtime hardening for that last failure mode:

- Provider stream errors with HTTP-like status codes are now classified as
  `APIError`, so transient `5xx` and `429` provider failures can use the normal
  retry path instead of becoming `UnknownError`.
- The session processor now detects the exact AI SDK usage-shape TypeError seen
  in the PR #1833 logs and retries it as a provider API failure.
- Tests cover both the external `524` provider error shape and the
  `usage.inputTokens.total` TypeError.

## Archived Evidence

The downloaded evidence is stored under this directory:

- `data/external-pr-1833.json`: PR metadata, comments, commits, files, and check
  rollup.
- `data/external-pr-1833-issue-comments.json`: PR conversation comments,
  including the auto-restart comments and failure comment.
- `data/external-pr-1833-review-comments.json` and
  `data/external-pr-1833-reviews.json`: review surfaces. Both were empty.
- `data/external-pr-1833-runs.json` and `data/actions-run-*.json`: GitHub
  Actions run metadata and per-run metadata.
- `logs/solution-draft-log-pr-*.txt`: five full solution-draft and restart logs
  downloaded from the PR gist links with `gh gist view --raw`.
- `logs/actions-run-*.log`: GitHub Actions logs for all 16 PR-triggered runs.
- `artifacts/`: downloaded workflow artifacts that are small enough to commit.
  See `artifacts/README.md` for the Windows build artifact note.
- `research/online-references.md`: official documentation used to interpret the
  GitHub, git, and AI SDK behavior.

No screenshots or image attachments were present in the issue or PR data.

## External Requirement

External issue #1826 requested that the shotgun and offensive grenade unlock
after completing the Building map at any rank, including rank F.

PR #1833's final diff made the expected functional change in
`scripts/autoload/unlock_manager.gd`:

- `min_rank` for `res://scenes/levels/BuildingLevel.tscn` changed from `D` to
  `F`.
- `grenades` changed from `[1]` to `[1, 3]`, adding the offensive grenade type.

The PR head commit was
`dd5c998953f67e83c6cc3ce23f4b390a121bbe7c`, titled
`Remove leftover .gitkeep (post-cleanup fallback, Issue #1436)`.

## Timeline

All timestamps are UTC.

- 2026-04-13 18:11:49: External issue #1826 was opened.
- 2026-04-15 16:54:10: The agent created initial commit
  `ea966c531d62c3267848507ad43a2ad90d6c6881` and pushed
  `issue-1826-328adfe76998`.
- 2026-04-15 16:54:16: PR #1833 was created.
- 2026-04-15 16:55:46: Auto-restart 1/3 reported an uncommitted modification in
  `scripts/autoload/unlock_manager.gd`.
- 2026-04-15 16:56:40: Auto-restart 2/3 reported the same uncommitted file.
- 2026-04-15 16:57:22: Auto-restart 3/3 reported the same uncommitted file.
- 2026-04-15 16:59:26: The model response said it would commit the changes but
  emitted malformed tool-call marker text rather than executing `git commit`.
- 2026-04-15 17:01:42: Auto-restart-until-mergeable started another iteration
  because uncommitted changes remained.
- 2026-04-15 17:03:55: The provider stream contained a code `524` error, and
  the session ended with the usage-shape TypeError.
- 2026-04-15 17:04:05: The PR received the "Solution Draft Failed" comment. At
  the same timestamp, fallback cleanup produced commit
  `dd5c998953f67e83c6cc3ce23f4b390a121bbe7c`.
- 2026-04-15 17:04:10 to 17:07:45: All checks for the final head SHA completed
  successfully.
- 2026-04-15 17:08:06: PR #1833 was closed without merge.
- 2026-04-15 18:25:55: The external issue received a follow-up asking to try
  again.

## Findings

### Branch Writes Were Possible

The evidence does not support a branch permission or protection root cause:

- The initial push command was `git push -u origin issue-1826-328adfe76998`, and
  the PR was created from that branch.
- Upstream repository permissions for the viewer were read-only, but the PR head
  was a fork branch in `konard/Jhon-Crow-godot-topdown-MVP`.
- The viewer had `ADMIN` permission on the fork.
- The fork branch reported `protected: false` and no enforced protection.
- The ruleset check for `issue-1826-328adfe76998` in
  `Jhon-Crow/godot-topdown-MVP` reported that no rules applied to that branch.

### The Working Tree Stayed Dirty Across Restarts

PR comments and logs repeatedly reported the same modified file:
`scripts/autoload/unlock_manager.gd`. The later log also shows the model knew the
file already contained the intended fix, but the session did not successfully
stage, commit, and push through the ordinary model/tool path.

The clearest log evidence is in `log-excerpts.md`.

### The Model Produced Commit Text, Not a Commit Tool Call

During the third restart, the model emitted text that looked like a broken tool
call close sequence and said it would use `git commit`. The actual tool
invocation was never made, so the uncommitted file remained. This is an
orchestration failure: a dirty-tree recovery path that is required for PR
correctness should not depend only on the model voluntarily emitting a valid git
tool call.

### Provider Error Handling Hid The Useful Failure

The final failure stream included a provider error object with code `524`. The
session then recorded an `UnknownError` whose message was the downstream
`usage.inputTokens.total` TypeError. That made the failure look like a local
usage accounting crash rather than a transient provider stream failure.

The code change in this PR preserves that distinction by classifying HTTP-like
provider stream errors as `APIError` and by recognizing the usage-shape
TypeError as retryable provider fallout.

### Secondary Instrumentation Issue

The initial creation log also contains `fatal: not a git repository` while
counting comments. The surrounding log continues, so this was not the PR-branch
write failure, but it is a useful diagnostic gap: status/comment tooling should
log cwd, repo root, and git command context when it shells out.

## Recommended Follow-Up Plan

1. Add a deterministic dirty-tree finalizer outside the model loop. When
   auto-restart detects uncommitted changes, the controller should run
   `git status --porcelain`, `git diff --check`, a scoped `git add`, `git commit`,
   and `git push` itself when the change set matches the active task or a known
   cleanup fallback.
2. Add branch-target preflight before editing: record PR head repository, head
   branch, viewer permission on the head repository, branch protection/ruleset
   state, local tracking branch, remote URL, and remote head SHA.
3. Make PR finalization fail loudly if the working tree is dirty. The failure
   comment should include status and diffstat instead of starting another
   unconstrained model session indefinitely.
4. Treat provider stream failures as retryable when they contain `429` or `5xx`
   status semantics. The current PR implements this for the session error
   classifier.
5. Add structured diagnostics around malformed model outputs that contain tool
   marker fragments as text. After repeated no-tool progress on a required
   operation, switch provider/model or run the deterministic controller path.
6. Fix the comment-count git cwd bug by logging `pwd`, `git rev-parse`, and the
   failing command when any git shell-out fails.

## Components And Libraries Checked

The existing repository already has the right building blocks:

- `ai` / AI SDK `streamText` and `fullStream` handling. Official AI SDK docs
  document that full streams can include error parts and still need `try/catch`
  around stream iteration.
- `MessageV2.fromError`, `SessionRetry`, and `RetryFetch`, which already
  provide a retry path for API, socket, timeout, and server errors.
- `@octokit/rest` and `@octokit/graphql`, which can retrieve PR head repository,
  branch protection, rulesets, checks, and comments without scraping.
- Git CLI and GitHub CLI. `gh pr checkout` supports checkout of PRs from forks,
  and git's own fast-forward rules explain when normal push, pull/rebase, or
  `--force-with-lease` is appropriate.

No new dependency is necessary for the fix in this PR.

## Remaining Gaps

The public evidence is sufficient to identify the failure mode, but it does not
include the private controller implementation that decided when to auto-restart
and when to run fallback cleanup. Because of that, this PR fixes the local Agent
CLI error classification and documents the deterministic controller changes as
follow-up work rather than pretending the whole orchestration stack is changed
here.
