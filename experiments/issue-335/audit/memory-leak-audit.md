# Memory and resource leak audit (issue #335)

Scope: `js/src` (primary, long-running CLI / continuous / server modes) and
`rust/src` (tools + CLI). Read-only audit; no source file was edited.
Bun 1.4.4. Every finding below was checked against the surrounding code.

Severity: high = grows per tool call / LLM step in normal use; medium = per
session or per turn; low = bounded or one-off.

Experiments (all in this directory; run from `js/` with
`timeout 90 bun ../experiments/issue-335/audit/<file>.ts`):

| Script | Result |
| --- | --- |
| `sse-usage-growth.ts` | 1000 simulated steps -> 1000 retained entries; one `consumeLatestUsage()` removes 1 (999 left). CONFIRMED |
| `tee-no-cancel.ts` | 25 MB streamed response: peak extra RSS 25 MB when the usage branch only `break`s, 7 MB when it also cancels. CONFIRMED |
| `abort-any-retention.ts` | `AbortSignal.any([longLived, ...])` + abort listener: 0/200 listener closures collected while the parent lives (200/200 without a listener, 200/200 once the timeout source fires). CONFIRMED |

---

## Confirmed

### 1. `SSEUsageExtractor.pendingUsage` grows by one entry per LLM request (high)

- Where: `js/src/util/sse-usage-extractor.ts:15` (`const pendingUsage = new Map()`).
  Entries are added in `processStreamForUsage` (`:86`). The callers are
  `js/src/provider/provider.ts:1212` (non-verbose path) and `:1390` (verbose path).
- Resource: one `SSEUsageData` per streamed response that carries a usage
  chunk. Small entries, but a module-level map that is never pruned.
- Growth trigger: every LLM step whose SSE body carries usage. The only consumer
  is `js/src/session/processor.ts:483` (`consumeLatestUsage()`). It runs only
  when the AI SDK reported zero tokens, so with a normal provider nothing is
  ever removed. Even when it does run, it removes only the newest entry.
- Side effect (correctness): when the SDK does report 0 tokens,
  `consumeLatestUsage` picks the newest entry across all sessions and requests.
  With concurrent sessions in server mode, it can pick up another request's
  usage.
- Fix: return the request id with the response (or keep a per-request
  callback) and `consumeUsage(id)` at finish-step. Minimal option: keep only
  the latest entry (`pendingUsage.clear()` before `set`), or cap the map to the
  last ~16 entries.

### 2. Usage tee branch is abandoned without `cancel()` (medium: per-response duplication, released at stream end)

- Where: `js/src/provider/provider.ts:1199-1216` (non-verbose path, the default).
  ```ts
  const [sdkStream, usageStream] = response.body.tee();
  ... if (body.length > 50000) break;   // reader never cancelled
  ```
- Resource: the tee keeps queueing every later chunk into the unread
  `usageStream` branch until the response ends. Peak memory for every LLM
  response over 50 KB is therefore 2x the response size; the experiment
  measured 25 MB extra for a 25 MB stream versus 7 MB with cancel.
- Second effect: a tee source is cancelled only when *both* branches cancel.
  If the SDK cancels its branch without aborting the fetch (for example it
  stops consuming early), the HTTP body keeps downloading into the orphaned
  branch.
- Functional bug in the same spot: usage is normally in the last SSE chunk.
  Cutting at the first 50 KB means long responses never yield usage, so the
  #249 fallback silently fails for them.
- Fix: after the loop, call `reader.cancel().catch(() => {})`. Do not
  `await` it inline: by the Streams spec a tee branch's cancel promise settles
  only when the other branch also cancels or the source closes. The first
  version of the experiment deadlocked on exactly this. Better still, keep
  reading to the end but retain only a rolling tail (for example the last 8 KB)
  and parse usage from that.

### 3. bash tool: command-stream keeps the whole output in memory, and the runner is pinned by an abort listener (high for large outputs)

- Where: `js/src/tool/bash.ts:231-232` and `:296-300`.
  ```ts
  const timeoutSignal = AbortSignal.timeout(timeout);           // 60 s default, 10 min max
  const cancel = AbortSignal.any([ctx.abort, timeoutSignal]);
  new ProcessRunner(..., { signal: stop?.signal ?? cancel, capture: true, ... })
  ```
- Resource, part (a): unbounded buffering. `capture: true` makes
  command-stream push every stdout and stderr chunk into
  `runner.outChunks/errChunks`. See command-stream 2.6.0
  `src/$.process-runner-execution.mjs:291,331`. At exit it also builds
  `Buffer.concat(...).toString()` (`:461-468`).

  bash.ts carefully keeps only `2 * MAX_BYTES` of output (`:234-249`), but the
  runner holds the full output twice. A command that prints 500 MB costs about
  1 GB. bash.ts only reads `command.result.child.signalCode` from the result.
- Resource, part (b): retention. `setupExternalAbortSignal` (`:545`) adds
  `signal.addEventListener('abort', () => stopForAbort(runner))` and never
  removes it. Bun keeps an `AbortSignal.any` dependent that has a listener
  alive while a source is alive; the `abort-any-retention.ts` experiment showed
  0/200 closures collected.

  So the runner and its captured buffers outlive the tool call until the
  timeout fires (60 s to 10 min) or the turn ends. `prompt.ts` aborts the
  per-loop controller in `cancel()` via `defer`. In a busy turn, every bash call
  of the last 60 s or more stays resident at once.
- Growth trigger: every bash tool call (default timeout 60 s).
- Fix: pass `capture: false`. The tool consumes `command.stream()` chunks
  itself. Confirm that the `stream()` and `result.child` paths still work with
  capture off in the pinned version. Also give the runner its own
  `AbortController`, link it with a listener that bash.ts removes in a
  `finally`, and abort the private controller in the `finally` so command-stream's
  listener is released immediately.
- Version note: `bun.lock` pins command-stream 2.4.0. Only 2.6.0 is in the
  local Bun cache, so the line numbers above are from 2.6.0. Re-check 2.4.0
  when node_modules is installed.

---

## Verified by reading (not reproduced)

### 4. grep tool reads all of rg's output, parses and stats every match, then keeps 100 (medium)

- `js/src/tool/grep.ts:81-83`: `new Response(proc.stdout).text()` buffers the
  complete `rg --json` output. A broad pattern in a large repo can produce
  hundreds of MB.
- `:119-153`: every match is JSON-parsed and `stat`ed one at a time, but only
  100 are returned (`:157`). The match lines themselves are not truncated
  until formatting.
- `:69-77`: the same `AbortSignal.timeout(30 s)` + `any([ctx.abort, ...])`
  pattern, passed to `Bun.spawn({ signal })`. This may pin the subprocess
  object for up to 30 s; low.
- Fix: stream stdout line by line and stop (kill rg) after N matches. Or pass
  `--max-count`/`--max-columns 2000 --max-columns-preview` and cap the bytes
  read, as `Ripgrep.files()` already does in `js/src/file/ripgrep.ts`.

### 5. `FileTime.state().read` is never pruned per session (medium)

- `js/src/file/time.ts:21-31,66-67`: `read[sessionID][path] = stamp`.
- Trigger: every distinct file read or written in every session, including
  subagent (task) sessions. It is freed only on `Instance.dispose`. In server
  mode or a long continuous run with many sessions this grows without bound.
  The per-entry size is small.
- Fix: delete `read[sessionID]` when a session is deleted or archived, and for
  subagent sessions when the task tool finishes. Alternatively, cap the number
  of sessions kept (LRU).

### 6. Continuous mode: per-message idle subscription leaks if `session.idle` never fires (low)

- `js/src/cli/continuous-mode.js:360-369` and `:586-595`: `checkIdle =
  Bus.subscribeAll(...)`, removed only inside the idle handler.
- `SessionPrompt.prompt` (`js/src/session/prompt.ts:252-263`) can throw before
  `loop()` runs: `Session.get`, `SessionRevert.cleanup` or `createUserMessage`.
  No idle event is published on that path. The subscription then stays forever,
  and `await messagePromise` hangs the input queue, because `isProcessing` is
  never reset.
- Fix: unsubscribe and resolve in the `.catch` of the prompt promise as well,
  for example with `Promise.race([messagePromise, promptPromise])` plus a
  `finally(checkIdle)`.

### 7. Upstream retry paths drop error responses without cancelling the body (low)

- `js/src/provider/retry-fetch.ts:463` (5xx retry) and `:556` (429 retry). The
  `Response` from the failed attempt is discarded and its body is neither read
  nor cancelled. The connection and buffer are released only by GC. Bodies
  are usually small.
- Fix: `await response.body?.cancel().catch(() => {})` before
  `sleep(...)`/`continue`.

### 8. `SessionRetry.sleep` leaves its abort listener attached after the delay elapses (low)

- `js/src/session/retry.ts:130-143`. Called from
  `js/src/session/processor.ts:805` with the turn's abort signal. Each retry
  adds a listener (`{ once: true }` only removes it after abort). The listeners
  are bounded by the retry count and released when the turn ends.
- Fix: `setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ...)`.
  `retry-fetch.ts:179-216` already does this correctly.

### 9. `withTimeout` keeps the timer when the wrapped promise rejects (low)

- `js/src/util/timeout.ts:4-7`. `clearTimeout` runs only on fulfilment, so a
  rejected MCP call (`js/src/mcp/index.ts:610-620`) leaves an unref'd timer
  and its closure alive until the timeout.
- Fix: use `promise.finally(() => clearTimeout(timeout))`.

### 10. `Instance.dispose()` leaves the directory in `cache` (low)

- `js/src/project/instance.ts:13,58-62`. `dispose()` disposes the state but does
  not `cache.delete(directory)`, so the resolved `Context` stays. Only
  `disposeAll()` clears it (`:73`). One entry per directory ever served
  (server mode with per-request `directory`).
- Fix: `cache.delete(Instance.directory)` in `dispose()`.

### 11. Pending permission asks are not dropped on session abort (low)

- `js/src/permission/index.ts:383-390`. `pending[sessionID][id]` holds a
  promise and its resolve and reject functions until answered or until
  `Instance` is disposed (`:320-330`). An aborted turn that was waiting on
  `ask` leaves its entry behind.
- Fix: reject and delete the entries for a session when its abort signal fires
  (`SessionPrompt.cancel`).

### 12. Server: client disconnect does not cancel the turn (low to medium)

- `js/src/server/server.ts:195-201`. `POST /session/:id/message` awaits
  `SessionPrompt.prompt` inside `stream()`. When the HTTP client disconnects,
  the turn, with its LLM stream and tools, keeps running to completion.
- Fix: `stream.onAbort(() => SessionPrompt.cancel(sessionID))`.

### 13. Optional per-request provider timeout signal (low)

- `js/src/provider/provider.ts:1131-1137`. This is `AbortSignal.any([init.signal,
  AbortSignal.timeout(t)])` per request, only when a provider `timeout` is
  configured. The SDK's listeners on it are pinned until the timeout fires.
  This is the same mechanism as item 3, but no large buffers are attached.

### Rust (`rust/src`)

### R1. bash timeout kills only the shell, not its process tree (medium)

- `rust/src/tool/bash.rs:111-139`. The child is spawned without
  `process_group(0)`/`setsid`, and `child.kill()` sends SIGKILL to `bash` only.
  Background or pipeline grandchildren (`cmd &`, `a | b`, servers) survive as
  orphans after every timed-out call.
- Second effect: if a grandchild inherits stdout, `pump` never sees EOF after
  `bash` exits. The call then always waits for the full timeout.
- Fix: `cmd.process_group(0)` (tokio `Command::process_group`, Unix). On
  timeout, `libc::killpg(pgid, SIGKILL)`. On Windows, use a job object or
  `taskkill /T`.
- Output buffering is fine. `Capture` keeps at most `4 * MAX_BYTES` per stream
  (`:209-222`).

### R2. Rust grep loads whole files and collects unlimited results (low to medium)

- `rust/src/tool/grep.rs:158-197,204-240`. `collect_files` walks everything
  except `.git`, with `follow_links(true)` and no `.gitignore` handling. It
  then runs `fs::read_to_string` on every file, a blocking call on the async
  runtime. `results` is unbounded unless the caller passes `head_limit`.
- Fix: default the limit (for example 100 entries, as in JS), skip files over a
  size cap, honour ignore files (the `ignore` crate), and use
  `spawn_blocking`.

### R3. Rust read loads the whole file before slicing (low)

- `rust/src/tool/read.rs` (`async_fs::read(&filepath)` after the binary
  sample). This is a one-off per call, but a multi-GB file is fully
  materialized.
- Fix: read with a `BufReader` line by line up to `offset + limit`.

---

## Checked and found OK (not leaks)

- `session/prompt.ts` `state` per session: removed via
  `using _ = defer(() => cancel(sessionID))`.
- `session/status.ts`: the entry is deleted on idle.
- `session/retry.ts` `retryStates`: cleared on finish, on non-retryable errors
  and on overflow.
- `tool/task.ts`: the abort listener is removed via `defer`, and Bus `unsub`
  runs in a `finally`.
- `tool/webfetch.ts`: bodies are cancelled and `readBounded` caps the read;
  the timeout signal is not linked to a capturing listener.
- `file/ripgrep.ts` `files()`: the `finally` cancels the reader, kills rg and
  awaits exit.
- `mcp/index.ts`: state dispose closes clients and kills descendants; failed
  clients are closed in `tools()`.
- `bus/index.ts` unsubscribe, `util/lock.ts` (empty locks removed),
  `util/log.ts` (one logger per service), `util/verbose-fetch.ts` (log tee
  read to the end).
- `provider/model-discovery.ts` caches: bounded.
- `provider/retry-fetch.ts` own `sleep` and `createIsolatedRateLimitSignal`:
  cleaned up in `finally`.
- `tool/tool.ts` `define`: wrapper accumulation already fixed (see
  `../bash-web/define-accumulation.ts`).
- `session/processor.ts:258` calls `MessageV2.parts()` per tool-call event for
  doom-loop detection. That is CPU and IO per event, not retained memory.
