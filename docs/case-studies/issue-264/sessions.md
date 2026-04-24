# PR #1833 Per-Session Agent CLI Trace

All five working sessions in the external PR
<https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1833> ran the same Agent
CLI invocation (line 10 of each gist log):

```
/workspace/.nvm/versions/node/v20.20.2/bin/node /workspace/.bun/bin/solve \
  https://github.com/Jhon-Crow/godot-topdown-MVP/issues/1826 \
  --tool agent \
  --attach-logs \
  --verbose \
  --no-tool-check \
  --auto-accept-invite \
  --tokens-budget-stats
```

The provider was `opencode` and the requested model was
`opencode/nemotron-3-super-free`. Session logs are stored under `logs/`. All
line numbers below reference the raw gist logs in that folder.

## Session 1 — initial draft (`logs/solution-draft-log-pr-1776272132190.txt`)

| Field | Value |
| --- | --- |
| Wall time | 2026-04-15T16:53:41Z → 16:55:25Z (~1m 44s) |
| Exit | `hasError: false` (line 14780, `"message": "Agent exiting"`) |
| Commits by Agent CLI | 0 (initial commit is created via git by the solver wrapper before the agent starts, not by an agent tool call) |
| Branch push | `git push -u origin issue-1826-328adfe76998` exited 0 (line 1168) |
| PR create | `gh pr create --draft` returned PR #1833 (lines 1228–1229) |
| Working tree at end | Dirty: `M scripts/autoload/unlock_manager.gd` (line 14792) |

**What Agent CLI actually did.** After the wrapper pushed the branch and
created the draft PR, Agent CLI entered its main `Session.processor` loop and
called OpenCode Zen's `chat/completions` endpoint once
(`bodyPreview` stream at lines 2586–2609). The model asked Agent CLI to run
the `Edit` tool against `scripts/autoload/unlock_manager.gd` and returned a
second edit call whose `oldString` equalled `newString`. The Edit tool
rejected that second call with `"Error: oldString and newString must be
different"` (line 13750). The model then emitted `step-finish` with
`finishReason: "stop"` and Agent CLI disposed its instance normally (line
14780).

**Why the working tree was dirty when the session ended.** The wrapper runs
`git status --porcelain` after Agent CLI exits. Agent CLI itself never
received a `git commit` tool call from the model during this session, so the
first valid edit stayed uncommitted on disk. This is not an Agent CLI error;
it is an unconditional outcome of a session that does not include a commit
tool call.

**Misleading diagnostic.** Lines 1263–1264 show two stray
`fatal: not a git repository` stderrs. They come from a status/comment
bookkeeping subprocess that ran in a different cwd; the successful push above
proves the actual session cwd was a git work tree. This is a logging bug, not
a branch-write failure.

## Session 2 — auto-restart 1/3 (`logs/solution-draft-log-pr-1776272187682.txt`)

| Field | Value |
| --- | --- |
| Wall time | 2026-04-15T16:55:39Z → 16:56:26Z (~47s) |
| Exit | `hasError: false` (line 23606) |
| Git commands run by Agent CLI | `git status` (lines 16365–16368 show `M scripts/autoload/unlock_manager.gd`) |
| Tool calls | One successful `Edit` (lines 21242–21274): `"grenades": [1]` → `"grenades": [1, 3]` |
| `git commit` from model | None |
| Working tree at end | Dirty (no commit tool call was emitted by the model) |

**What Agent CLI actually did.** The wrapper relaunched the solver in "temporary
watch" mode. Agent CLI resumed against the same branch, saw the dirty file
via `git status`, and the model produced the second required edit: the
`grenades` list change. The model then emitted `step-finish` with
`finishReason: "unknown"` (the provider SSE omitted the finish reason) and
Agent CLI cancelled the session and exited normally.

**Why the working tree was still dirty.** The model called `Edit` but never
called any git tool after the edit. Agent CLI honours the tool calls that the
model sends; it does not run `git add` and `git commit` on its own from the
processor loop. With no commit tool call, the second edit piled onto the
first and the tree stayed dirty.

## Session 3 — auto-restart 2/3 (`logs/solution-draft-log-pr-1776272226408.txt`)

| Field | Value |
| --- | --- |
| Wall time | 2026-04-15T16:56:34Z → 16:57:04Z (~30s) |
| Exit | `hasError: false` (around line 29304) |
| Tool calls | Minimal — model produced near-empty output (22 output tokens for 41,835 input) and several `finishReason: "unknown"` steps |
| `git commit` from model | None |
| Working tree at end | Dirty |

**What Agent CLI actually did.** Agent CLI made the same streaming call, but
Nemotron 3 Super Free emitted almost no output. The conversation was already
long enough (summary over 27k input tokens) that the model kept returning
`finish_reason: "stop"` or `"unknown"` with empty deltas. The processor
records the step and exits the main loop when the last step finishes without
any tool calls, so the session ended without emitting any git tool call.

## Session 4 — auto-restart 3/3 (`logs/solution-draft-log-pr-1776272368622.txt`)

| Field | Value |
| --- | --- |
| Wall time | 2026-04-15T16:57:04Z → 16:59:26Z (~142s) |
| Exit | `hasError: false` (line 47746) |
| Tool calls | None; model produced malformed tool-call text in reasoning and text parts |
| `git commit` from model | None (see below) |
| Working tree at end | Dirty |

**Malformed tool-call text in the stream.** The most important evidence in the
whole archive is on lines 46700–46776. The provider streamed a `delta.content`
chunk that ended with the model's attempt at a tool call written out as
literal text inside the content channel rather than as a proper
`tool-call` stream part:

```
"Now, let's proceed with the next step: commit the changes to the repository.
We'll use the git commit command to commit the changes
</parameter>
<parameter=description>
Commit changes to the repository
</parameter>
</function>
</tool_call>"
```

The fragment uses the Qwen/Kilo-family XML schema (`<function>`,
`<parameter>`, `<tool_call>`). Nemotron 3 Super Free has no native tool-use
output, so the model tried to simulate it with a text template. The AI SDK
stream parser only treats `tool-call` stream parts (or `tool_use` message
parts, for models that emit them) as tool calls — everything else that
arrives in `delta.content` or `delta.reasoning_content` becomes a `text-delta`
or `reasoning-delta`. Because the provider placed the fake tool call inside
`delta.content`, Agent CLI stored it verbatim as message text (line 46775)
and never invoked any tool. The session ended with `finishReason: "stop"`
and a clean exit.

**Why Agent CLI could not recover here.** The processor's contract is that
tool invocations are driven by the model. There is no inner heuristic that
scans assistant text for XML-encoded tool calls, so it cannot rescue a model
that streams tool syntax into the content channel. This is where the dirty
tree became structurally impossible to fix without a model that actually
emits tool calls, or a deterministic controller outside the processor that
runs `git add` and `git commit` without waiting for the model.

## Session 5 — auto-restart-until-mergeable iteration 1 (`logs/solution-draft-log-pr-1776272637847.txt`)

| Field | Value |
| --- | --- |
| Wall time | 2026-04-15T16:59:36Z → 17:03:56Z (~4m 20s) |
| Exit | Failure: `AGENT execution failed` (line 52732) |
| Critical error | `UnknownError: TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')` (lines 52581–52583) |
| Upstream trigger | SSE error chunk `"error":{"code":524,"message":"Provider returned error"}` (line 52558) |
| `git commit` from model | None |
| Working tree at end | Dirty (then overwritten by wrapper fallback cleanup at 17:04:05) |

**Precise Agent CLI failure path.** The provider sent a normal HTTP 200 SSE
stream. Near the end of that stream it emitted an `error` object with
`code: 524` (line 52558) and then closed the stream without ever sending a
`finish-step` part. When the iterator in `Session.processor.process` reached
the end of `stream.fullStream`, the AI SDK ran its internal
`onFinish`/`step-finish` post-processing, which dereferences fields such as
`usage.inputTokens.total`. Because the stream ended in an error, the usage
object was `undefined`. Bun's JSC runtime reported:

```
TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')
```

Before the PR #265 fix, this TypeError propagated out of the stream iterator,
into the processor's catch block (`js/src/session/processor.ts:576`), and
through `MessageV2.fromError`, where it landed in the generic
`NamedError.Unknown` branch (no handler matched `APICallError.isInstance`,
`LoadAPIKeyError.isInstance`, or the socket/timeout string checks). The
processor then exited because `error.name === 'APIError'` was false and
there was no retry. The wrapper's fallback pattern matcher then printed
`Error event detected via fallback pattern match: TypeError: undefined is
not an object (evaluating 'usage.inputTokens.total')` (lines 52710–52713) and
stopped `auto-restart-until-mergeable` (lines 52732–52733).

**Relationship to the 524 provider error.** The 524 was the real underlying
problem: OpenRouter uses HTTP 524 as an unmapped provider error, typically a
Cloudflare upstream timeout. It is a textbook transient 5xx. If it had been
caught as `APIError` with `statusCode: 524` and `isRetryable: true`,
`Session.processor` would have retried the stream using the normal backoff
path. Instead, the 524 was hidden behind a local usage-accounting crash and
the entire session was marked unrecoverable.

## Why Agent CLI could not finish the task

The five sessions together show three distinct ways a Nemotron-class model +
OpenCode Zen stream prevented Agent CLI from committing the working-tree
change:

1. **No commit tool call (sessions 1, 2, 3).** The model produced valid
   `Edit` tool calls but never produced a git tool call. Agent CLI has no
   path to a commit that does not start with a `tool-call` stream part from
   the model, so the change accumulated in the working tree and the wrapper
   kept auto-restarting.
2. **Text-encoded tool calls (session 4).** The model emitted its tool call
   as XML text in the content channel. The AI SDK stream parser, and in turn
   `Session.processor`, only treat explicit `tool-call` parts as invocations.
   The text was stored as an assistant message part and ignored. The model
   did not try again.
3. **Provider error hidden by a local crash (session 5).** An OpenRouter-style
   `524` arrived inside the SSE as a plain JSON `error` chunk rather than an
   HTTP error, then the AI SDK's end-of-stream finalizer tripped over the
   missing `usage` object and produced a
   `TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')`.
   `MessageV2.fromError` had no case for that TypeError, so the error was
   classified as `UnknownError`, the retry path in `Session.processor` was
   skipped, and `auto-restart-until-mergeable` stopped.

Only the third failure mode is a defect in Agent CLI's own logic. The first
two are model-capability failures: the model in question does not emit
first-class tool calls consistently. The processor behaves correctly — it
cannot execute a commit that was never requested — but the overall solver
needs an out-of-loop safety net for exactly this class of model if we still
want the change to land on the branch.
