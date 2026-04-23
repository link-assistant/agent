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

For a per-session, line-cited reconstruction of every working session inside
PR #1833 (what Agent CLI did, what the model produced, and why the working
tree stayed dirty), see [`sessions.md`](sessions.md). That document is the
source of truth for the timeline and the Agent-CLI-only explanation requested
in the PR discussion; this README keeps the higher-level findings and fix
plan.

For an exhaustive line-by-line walk-through of the two Agent CLI patches in
this PR (`normalizeProviderErrorObject` and `isUsageDataTypeError`), plus a
side-by-side comparison with how sst/opencode (upstream), google-gemini/
gemini-cli, openai/codex, and the Vercel AI SDK handle the same concerns,
see [`code-deep-dive.md`](code-deep-dive.md).

## Why Agent CLI Could Not Finish The Task (Agent CLI Logic Only)

Ignoring the wrapper and the auto-restart controller entirely, three
different Agent CLI code paths explain each dead end in PR #1833. Each maps
to a specific session in `sessions.md`.

### 1. The processor cannot commit without a model-emitted tool call

`js/src/session/processor.ts` iterates the AI SDK `stream.fullStream`. The
only way a `git commit` happens is for the stream to contain a `tool-call`
part naming a shell/git tool with the right input; the processor then calls
`Session.updatePart(..., state: 'running')` and runs the tool. There is no
fallback that scans assistant text for "commit" intent and runs git itself.

In sessions 1, 2, and 3 the Nemotron model emitted valid `Edit` tool calls
but never emitted any git tool call. The edits accumulated on disk; the
processor finished the last step with `finishReason: "stop"` or
`"unknown"` and the wrapper's `git status --porcelain` reported the same
`M scripts/autoload/unlock_manager.gd` that it had reported before the
session started. This is the processor behaving correctly — it cannot
execute a commit it was never asked to execute.

### 2. Text-encoded tool calls are stored as plain text

In session 4 the model tried to call the git tool by emitting XML like
`<tool_call><function>git commit ...</function></tool_call>` inside
`delta.content`. The AI SDK stream parser turns `delta.content` into
`text-delta` parts and `delta.reasoning_content` into `reasoning-delta`
parts. It does not look for tool-call syntax embedded in those text
channels. `Session.processor` therefore stored the fragment under
`type: "text"` (see log line 46775) and never created a tool part. The
session exited cleanly with no tool execution, and the dirty tree
persisted. See `sessions.md` for the exact text.

### 3. Usage-shape TypeError hid a retryable 524

Session 5 is the only one where Agent CLI's logic itself is at fault. The
provider sent a 200 stream that ended with an SSE `error` chunk
`{"code":524,"message":"Provider returned error"}` and no `finish-step`
part. The AI SDK's end-of-stream finalizer then read
`usage.inputTokens.total` on an undefined usage object and threw
`TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')`.

That TypeError entered the processor catch block at
`js/src/session/processor.ts:576`:

```ts
} catch (e) {
  log.error(() => ({ message: 'process', error: e }));
  let error = MessageV2.fromError(e, { providerID: input.providerID });
```

Before this PR, `MessageV2.fromError` (`js/src/session/message-v2.ts:894`)
matched neither `APICallError.isInstance`, nor `LoadAPIKeyError`, nor the
socket/timeout string patterns, and fell through to the generic
`NamedError.Unknown` case (line 958). `error.name` became `UnknownError`,
the retry gate at `js/src/session/processor.ts:608`
(`error?.name === 'APIError' && error.data.isRetryable`) was false, and the
processor exited. The wrapper then printed "AGENT execution failed" and
stopped `auto-restart-until-mergeable`.

Equally damaging, when the SSE error chunk was extracted cleanly (as a
plain object with `code: 524`), `MessageV2.fromError` had no case for it
either — it is not an `APICallError` instance — so it also became
`UnknownError`. A transient 5xx provider error looked identical to a local
code crash.

### What this PR changes in Agent CLI

Two targeted patches to `js/src/session/`:

1. **`message-v2.ts` — `normalizeProviderErrorObject`** (lines 852–892) and
   the added switch case at `fromError` (lines 929–932). Any error object
   with a numeric `code`, `statusCode`, or `status` (including nested under
   `.error`) is converted to `MessageV2.APIError` with `statusCode` preserved
   and `isRetryable = 429 || 5xx`. The SSE `524` chunk now becomes a
   retryable `APIError` instead of `UnknownError`.
2. **`processor.ts` — `isUsageDataTypeError`** (lines 65–87) and the check
   at lines 583–605. If the caught exception is a `TypeError` whose message
   mentions any of `usage.inputTokens`, `usage.outputTokens`,
   `inputTokens.total`, `outputTokens.total`, `input_tokens`,
   `output_tokens`, `reading 'inputTokens'`, or `reading 'outputTokens'`,
   the processor wraps it in a retryable `APIError` and goes through the
   normal `SessionRetry.delay` path instead of exiting.

With both patches, the session-5 stream now retries via
`SessionRetry.shouldRetry` + `SessionRetry.delay` on both the 524 and the
usage-shape TypeError. It does not rescue sessions 1–4 (those require a
controller-level fallback that is out of scope for this PR and listed under
*Recommended Follow-Up Plan*), but it stops the final provider hiccup from
looking like a local crash.

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

All timestamps are UTC. For per-session internal traces (tool calls, git
commands, stream events, exit reasons with log line numbers), see
[`sessions.md`](sessions.md).

- 2026-04-13 18:11:49: External issue #1826 was opened.
- 2026-04-15 16:53:41: Agent CLI was invoked with
  `solve ... --tool agent --attach-logs --verbose --no-tool-check --auto-accept-invite --tokens-budget-stats`
  and model `opencode/nemotron-3-super-free`.
- 2026-04-15 16:54:10: Initial commit `ea966c531d62c3267848507ad43a2ad90d6c6881`
  was pushed on `issue-1826-328adfe76998`.
- 2026-04-15 16:54:16: Draft PR #1833 was created.
- 2026-04-15 16:55:25: **Session 1 ended.** Agent CLI exited cleanly; the Edit
  tool had applied `min_rank: "F"` but no git commit tool call was ever
  requested by the model. Working tree: `M scripts/autoload/unlock_manager.gd`.
- 2026-04-15 16:55:46: Auto-restart 1/3 started.
- 2026-04-15 16:56:26: **Session 2 ended.** Edit tool applied
  `grenades: [1, 3]`; again no commit tool call. Working tree still dirty.
- 2026-04-15 16:56:40: Auto-restart 2/3 started.
- 2026-04-15 16:57:04: **Session 3 ended.** Model emitted almost no output
  (~22 tokens for 41,835 input). No tool calls. Working tree still dirty.
- 2026-04-15 16:57:22: Auto-restart 3/3 started.
- 2026-04-15 16:59:26: **Session 4 ended.** Model emitted a tool call encoded
  as XML text inside `delta.content`
  (`</parameter>...</function></tool_call>`); the stream parser stored it as
  plain text and no tool executed. Working tree still dirty.
- 2026-04-15 17:01:42: `auto-restart-until-mergeable` iteration 1 started.
- 2026-04-15 17:03:55: **Session 5 failed.** SSE error chunk with
  `code: 524` was followed by `TypeError: undefined is not an object
  (evaluating 'usage.inputTokens.total')`. `MessageV2.fromError` classified
  it as `UnknownError`, and `Session.processor` skipped the retry gate.
- 2026-04-15 17:04:05: Wrapper posted "Solution Draft Failed" and ran a
  fallback cleanup that produced `dd5c998953f67e83c6cc3ce23f4b390a121bbe7c`.
- 2026-04-15 17:04:10 to 17:07:45: All 16 CI runs across both head SHAs
  completed with conclusion `success`.
- 2026-04-15 17:08:06: PR #1833 was closed without merge.
- 2026-04-15 18:25:55: External issue received a follow-up asking to try
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

### The Working Tree Stayed Dirty Across All Five Sessions

The same file `scripts/autoload/unlock_manager.gd` showed as modified after
every session. `sessions.md` reconstructs what each session did, but the
underlying cause is shared: the Nemotron model never emitted a git tool call
that Agent CLI could execute. Sessions 1–3 produced legitimate `Edit`
tool calls and no follow-up commit call; session 4 produced a tool call as
XML text inside the content channel, which the stream parser stores as plain
text; session 5 crashed before reaching any tool call step.

Because `Session.processor` drives tool execution off of `tool-call` stream
parts, not off of model text, the dirty working tree was structurally
impossible to resolve from inside the session. `log-excerpts.md` still lists
the sharpest evidence lines; `sessions.md` is now the canonical trace.

### The Model Produced Commit Text, Not a Commit Tool Call

In session 4 (`logs/solution-draft-log-pr-1776272368622.txt` lines
46700–46776) the model emitted its tool call as XML text inside
`delta.content`:

```
</parameter>
<parameter=description>
Commit changes to the repository
</parameter>
</function>
</tool_call>
```

The AI SDK stream parser converts `delta.content` to `text-delta` parts. It
does not scan that text for tool-call syntax, and neither does
`Session.processor`. The fragment was stored under `type: "text"` at line
46775 and no tool ran. This is a model-capability failure rather than an
Agent CLI defect: the model in question does not reliably emit first-class
tool calls for this provider. A dirty-tree recovery path that is required
for PR correctness should not depend only on the model voluntarily emitting
a valid git tool call.

### Provider Error Handling Hid The Useful Failure (Agent CLI defect)

The session-5 failure is the one genuine Agent CLI bug visible in the
archive. The provider stream ended with an SSE `error` chunk
`{"code":524,"message":"Provider returned error"}` and no `finish-step`
part. The AI SDK's end-of-stream usage finalizer then dereferenced the
missing usage object and threw
`TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')`.

Before this PR, `MessageV2.fromError` had no case for either shape, so both
were classified as `UnknownError`. `Session.processor`'s retry gate only
fires for `APIError.isRetryable` (plus the socket/timeout variants), so a
transient 5xx was treated as a terminal local crash.

This PR restores that distinction: HTTP-like provider stream error objects
become `APIError` with their real status code, and the specific
`usage.inputTokens.total` / `inputTokens.total` / `usage.outputTokens`
TypeErrors are wrapped in a retryable `APIError` rather than leaking as
`UnknownError`.

### Secondary Instrumentation Issue

Session 1 (`logs/solution-draft-log-pr-1776272187682.txt` lines 1263–1264)
contains two `fatal: not a git repository` stderrs from a status/comment
bookkeeping subprocess that clearly ran in a different cwd, since the
preceding `git push` at line 1160 succeeded. This did not cause the dirty
tree, but it is a useful diagnostic gap: status/comment tooling should log
cwd, repo root, and the failing command when it shells out.

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
