# D — Session loop, tool-call processing, provider transforms, retry, MCP: upstream fixes missing from our fork

**Our code:** `/tmp/gh-issue-solver-1792704263647/js`. It runs on Bun with `ai` ^7.0.149, @ai-sdk/openai 4.0.100, @ai-sdk/anthropic 4.0.86, @ai-sdk/google 4.0.103 and @ai-sdk/mcp 2.0.82.

**Upstream sources:**
- Fork base `0068cb305f` (2025-11-19), snapshot at `/tmp/upstream/base`.
- Last pre-Effect-split snapshot at `/tmp/upstream/last/packages/opencode/src`, referred to below as "upstream last".

**How to read this report:**
- Our paths are relative to `js/src/`.
- Line numbers are from the working tree on 2026-10-22.
- "Strip Effect" means the logic is shown as plain async TypeScript.

---

## PORT candidates (ordered by severity)

### 1. Context overflow is fatal instead of triggering compaction — HIGH

**Upstream commits:**

| Commit | Date | PR | Change |
|---|---|---|---|
| `7a3ff5b98f` | 2026-01-01 | #6480 | mid-turn overflow |
| `62f38087b8` | 2026-02-08 | #12768 | |
| `d98bd4bd52` | 2026-02-10 | #13077 | |
| `be20f865ac` | 2026-03-02 | #14707 | 413 auto-compaction |
| `7e09660c3b` | 2026-06-04 | #30749 | respect `compaction.auto` |

**Bug.** When the provider rejects a request because the prompt exceeds the context window, the session turns that into a terminal `APIError`.
- This happens with HTTP 400 "prompt is too long", 413, or mid-stream `context_length_exceeded`.
- The session stops, so a long autonomous run dies.
- Proactive `isOverflow` (prompt.ts:748-763) only helps when our token estimate is right. It misses tokenizer drift, large tool outputs added in the same step, and providers that report no usage.

**Ours.** There is no overflow classification. `grep -rn "ContextOverflow\|413" js/src/session` finds nothing.
- `message-v2.ts:956-969` maps every `APICallError` to `APIError { message: e.message, statusCode, isRetryable }`.
- `processor.ts:583-738` either retries or stops.
- `processor.ts:762-764` never returns `'compact'`.

**Upstream logic (Effect stripped):**

The detection patterns come from `packages/ai/src/provider-error.ts`:

```ts
const OVERFLOW = [/prompt is too long/i, /input is too long for (?:the )?(?:requested|selected) model/i,
  /too large for the model'?s configured input limit/i, /exceeded this model context window limit/i,
  /exceeds the context window/i, /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i, /number of input tokens exceeds maximum length/i,
  /tokens in request more than max tokens allowed/i, /maximum prompt length is \d+/i, /reduce the length of the messages/i,
  /requested input length \d+ exceeds maximum input length/i, /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, /input(?: \(\d+ tokens\))? is longer than the model'?s context length/i,
  /exceeds the limit of \d+/i, /exceeds the available context size/i, /greater than the context length/i,
  /`inputs` tokens \+ `max_new_tokens` must be <= \d+/i, /context window exceeds limit/i, /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i, /context length is only \d+ tokens/i, /input length.*exceeds.*context length/i,
  /prompt (?:too long|exceeds max length|超长)/i, /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i, /model_context_window_exceeded/i,
  /range of input length should be/i, /too many tokens/i, /token limit exceeded/i, /request_too_large/i,
  /request entity too large/i, /payload too large/i, /request too large/i]
const EXCLUDE = [/^(throttling error|service unavailable):/i, /rate limit/i, /too many requests/i, /max[_ ]tokens must be less than/i]
export const isContextOverflow = (m: string) =>
  !EXCLUDE.some(r => r.test(m)) && (OVERFLOW.some(r => r.test(m)) || /^4(?:00|13)\s*(status code)?\s*\(no body\)/i.test(m))
```

This is how upstream classifies an `APICallError` (`provider/error.ts parseAPICallError`):

```ts
const body = tryJSON(e.responseBody)
if (isContextOverflow(e.message) || isContextOverflow(e.responseBody ?? "") || e.statusCode === 413 || body?.error?.code === "context_length_exceeded")
  return new ContextOverflowError({ message, responseBody: e.responseBody }).toObject()
```

For stream error objects (`parseStreamError`), `error.code === "context_length_exceeded"` maps to `ContextOverflowError`.

The processor handles it in `halt`:

```ts
if (ContextOverflowError.isInstance(error)) {
  if (config.compaction?.auto === false && !isSummary) { assistant.error = error; return "stop" }  // 7e09660c3b
  needsCompaction = true                                   // do not set assistant.error
}
...
return needsCompaction ? "compact" : ...
```

Upstream `prompt.ts` (L1320-1327):

```ts
if (result === "compact") { await SessionCompaction.create({ sessionID, agent, model, auto: true, overflow: !assistant.finish }); continue }
```

Upstream `compaction.ts` (L404-412): if the compaction stream itself returns `"compact"`, set `ContextOverflowError("Conversation history too large to compact - exceeds model context limit")` and return `"stop"`. This prevents an infinite loop.

**Apply:**
- `message-v2.ts`:
  - Add a `ContextOverflowError` NamedError: `{ message, responseBody? }`.
  - Add `isContextOverflow`.
  - In `fromError`, test it before the `APICallError` case at :956.
  - In `normalizeProviderErrorObject` (:864), test the `code`.
- `processor.ts` catch (:583):
  - On overflow, do not retry.
  - If `config.disableAutocompact` is set (already respected at compaction.ts:123-183), set the error and stop.
  - Otherwise skip setting `assistantMessage.error` and make `process()` return `'compact'`. Widen the return type.
- `prompt.ts:1042`:
  - Before `if (result==='stop') break`, add `if (result==='compact') { await SessionCompaction.create({ sessionID, model: { providerID: model.providerID, modelID: model.modelID } }); continue; }`.
  - This is the same call as :760.
- `compaction.ts` (around :423-448):
  - If the processor returns `'compact'`, set `processor.message.error = new ContextOverflowError({ message: 'Conversation history too large to compact - exceeds model context limit' }).toObject()`, save it, and return `'stop'`.

**Failing tests:**
- `MessageV2.fromError(new APICallError({ message: 'prompt is too long: 210000 tokens > 200000 maximum', url:'x', requestBodyValues:{}, statusCode: 400, isRetryable: false }), { providerID:'anthropic' }).name` should equal `'ContextOverflowError'`. Today it is `'APIError'`.
- The same check with `statusCode: 413, message: 'Request Entity Too Large'` should be overflow.
- The same check with `message: 'Rate limit exceeded: too many tokens per minute', statusCode: 429` should NOT be overflow, because of the exclusion.
- `fromError({ type:'error', error:{ code:'context_length_exceeded', message:'...' } })` should be overflow.

### 2. Provider stream-error objects are misclassified, so retryable 5xx are never retried — HIGH (our own bug, exposed by upstream `62f38087b8` #12768 and `027d43b5ea` 2025-12-01)

**Bug.** With AI SDK 7, a mid-stream provider error reaches `processor.ts:273-290` as a plain object built by `createProviderStreamError`. It looks like `{ message, type, code, statusCode, isRetryable, data }`.
- OpenAI and Anthropic set `code` to a STRING (`'server_error'`, `'overloaded_error'`, `'insufficient_quota'`, ...) and `statusCode` to a NUMBER.

**Ours** (`message-v2.ts:872-886`):

```ts
const rawCode = candidate['code'] ?? candidate['statusCode'] ?? candidate['status'] ?? root['code'] ?? root['statusCode'] ?? root['status'];
const statusCode = typeof rawCode === 'number' ? rawCode : typeof rawCode === 'string' && /^\d+$/.test(rawCode) ? ... : undefined;
if (statusCode === undefined) return;
```

The string `code` wins the `??` chain and then fails the digit test, so the function returns `undefined`.
- The error becomes `NamedError.Unknown`, and the `isRetryableAPIError` check (processor.ts:615) is false.
- The result: Anthropic `overloaded_error` (529) and OpenAI `server_error` (500) / `server_is_overloaded` (503) end the session instead of backing off.
- The SDK's own `isRetryable` is also ignored. :907 recomputes it from the status alone, so `insufficient_quota` (429) is retried for the full 7-day budget.

**Upstream logic** (`provider/error.ts parseStreamError`, plus the SDK fields):

```ts
const code = typeof err.code === "string" ? err.code : undefined
if (code === "context_length_exceeded") return overflow
if (code === "insufficient_quota" || code === "usage_not_included" || code === "invalid_prompt") return APIError({ isRetryable: false, ... })
if (code === "server_is_overloaded" || code === "server_error") return APIError({ isRetryable: true, ... })
```

**Apply** in `normalizeProviderErrorObject`:
- Take the numeric status first: `const num = [candidate.statusCode, candidate.status, root.statusCode, root.status, candidate.code, root.code].find(v => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))`.
- Keep `const strCode = [candidate.code, root.code, candidate.type, root.type].find(v => typeof v === 'string' && !/^\d+$/.test(v))`.
- Return when both are absent. Classify `context_length_exceeded` as overflow (#1).
- Set `isRetryable` as follows:
  - `false` for the three quota/prompt codes above;
  - `true` for `server_error`, `server_is_overloaded`, `overloaded_error`, `api_error`, `rate_limit_error`;
  - otherwise `typeof root.isRetryable === 'boolean' ? root.isRetryable : status===429 || status>=500`.

**Failing tests:**
- `fromError({ message:'The server had an error', type:'server_error', code:'server_error', statusCode:500, isRetryable:true }, {providerID:'openai'})` should give `name==='APIError'` with `data.isRetryable===true`. Today it is `UnknownError`.
- `{ type:'overloaded_error', code:'overloaded_error', statusCode:529, isRetryable:true }` should be a retryable APIError.
- `{ code:'insufficient_quota', statusCode:429, isRetryable:false }` should have `isRetryable===false`.

### 3. The agent loop exits after tool calls when the provider says finish `stop` — HIGH

**Upstream commits:**
- `733a3bd031` (2026-04-01, #14973).
- `748fcb7ebd` (2026-05-25, #26178) adds the orphan exclusion.

**Bug.** Some providers report `finish_reason: "stop"` even though the step contained tool calls. This includes OpenAI-compatible gateways, LiteLLM, some Kimi/Qwen/GLM hosts and Copilot.
- The tools run, but the loop exits before the results are sent back to the model.
- The agent silently stops mid-task.

**Ours** (`prompt.ts:337-341`):

```ts
if (lastAssistant?.finish && lastAssistant.finish !== 'tool-calls' && lastUser.id < lastAssistant.id) {
```

The tool-call safety check runs only inside the `finish === 'unknown'` branch (#194/#239). `processor.ts` finish-step only infers `'tool-calls'` when finishReason is undefined.

**Upstream logic** (upstream last prompt.ts L1105-1114 and the exit condition):

```ts
const isOrphanedInterruptedTool = (p) => p.type === "tool" && p.state.status === "error" && p.state.metadata?.interrupted === true
const hasToolCalls = lastAssistantParts.some(p => p.type === "tool" && !p.metadata?.providerExecuted && !isOrphanedInterruptedTool(p))
if (lastAssistant?.finish && !["tool-calls"].includes(lastAssistant.finish) && !hasToolCalls && lastUser.id < lastAssistant.id) break
```

**Apply** at `prompt.ts:337`:
- Compute `hasToolCalls` from `MessageV2.parts(lastAssistant.id)`. The `'unknown'` branch already loads the parts, so reuse them.
- Apply it to every finish reason, not just `'unknown'`.
- This depends on #17, which adds `metadata.interrupted`. Without it, an aborted tool would make the loop spin.

**Failing test:**
- Seed a session with a user message, then an assistant message with `finish:'stop'` and a completed `tool` part.
- `SessionPrompt.loop` must issue another LLM call. Use a mock model and count calls. Today it exits after 0 calls.
- A part with `state:{status:'error', metadata:{interrupted:true}}` must still exit.

### 4. MCP connect/initialize has no timeout, so a hung server blocks every session forever — HIGH

**Upstream commits:** `586e7347bd` (2026-01-03, #6760) and `2e6ac8ff49` (#19200).

**Bug.** A remote server that accepts TCP but never answers `initialize`, or a stdio command that never speaks MCP, hangs `MCP.state()`. Every `MCP.tools()` call waits on that state, so `resolveTools` never returns and the session never starts.

**Ours.** `mcp/index.ts:205-208` and `:241-243` call `experimental_createMCPClient({ name:'opencode', transport })` with no timeout.

**Upstream logic.** Pass a connect timeout; the default is 30 s.

**Apply.** @ai-sdk/mcp 2.0.82 supports `initializationOptions` (verified in `node_modules/@ai-sdk/mcp/dist/index.js:2417-2426`). On timeout it aborts with `MCPClientError("MCP client initialization timed out after Nms")`. Add this to both calls:

```ts
experimental_createMCPClient({ name:'opencode', transport, initializationOptions: { timeout: mcp.timeout ?? 30_000 } })
```

Also call `transport.close?.()` in the `.catch`.

**Failing test.** Configure a local MCP server with `command: ['node','-e','setInterval(()=>{},1e9)']` and `timeout: 300`. `await MCP.status()` must resolve within about 1 s with `status:'failed'`. Today it never resolves.

### 5. Lone UTF-16 surrogates reach the provider and get an HTTP 400 "invalid Unicode" — HIGH

**Upstream commit:** `6409aceb1a` (2026-05-05, #25934).

**Bug.** Truncating command or file output with `.slice()` can split a surrogate pair, for example in emoji or CJK text. Strict JSON parsers (Anthropic, Bedrock, Vertex) then reject the whole request. Every later turn repeats the 400, so the session is bricked. Our issue-146 case study already logs "invalid Unicode surrogate".

**Ours.**
- `tool/bash.ts:215` truncates output with a plain `.slice`.
- `provider/transform.ts:6-83` `normalizeMessages` has no sanitizer.

**Upstream logic** (upstream last transform.ts:26-28 and the start of `normalizeMessages`):

```ts
export const sanitizeSurrogates = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�")
```

It is applied to:
- system string content;
- `text` and `reasoning` part `.text`;
- tool-result `output.value` when `output.type` is `text` or `error-text`;
- `text` items inside `output.type==='content'`.

**Apply.** Run it as the first pass of `ProviderTransform.message` (transform.ts:133), before the provider-specific branches.
- Our `claude` branch returns early at :11, so the pass must come first.
- `ProviderTransform.message` runs for every request (prompt.ts:1029, compaction.ts:410).

**Failing test.** `ProviderTransform.message([{ role:'tool', content:[{ type:'tool-result', toolCallId:'a', toolName:'bash', output:{ type:'text', value:'ok\uD83D' } }] }], 'anthropic', 'claude-sonnet-4')` should produce a value ending in `'�'`. Today it is unchanged.

### 6. Empty text/reasoning parts and empty messages go to Anthropic/Bedrock, which returns 400 "text content blocks must be non-empty" — HIGH

**Upstream commits:**
- `c285304acf` (2026-01-05).
- `4a2a046d79` (#14586).
- `4e14f79511` (#26276) keeps signed or redacted reasoning.

**Bug.** Several things produce empty blocks:
- an aborted stream after `text-start`;
- whitespace-only reasoning;
- a tool-only step whose text is `""`.

Anthropic and Bedrock reject a request containing an empty block. Like #5, the error repeats on every turn.

AI SDK 7 `convertToModelMessages` drops only fully empty assistant messages. It does not drop empty parts inside messages that also have content.

**Ours.**
- `transform.ts:6-83` has no empty-part filter.
- `message-v2.ts:672-800` emits `{type:'text', text: part.text}` with no emptiness check.

**Upstream logic** (upstream last transform.ts:132-188):

```ts
if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/amazon-bedrock") {
  const ns = npm === "@ai-sdk/anthropic" ? "anthropic" : "bedrock"
  msgs = msgs.map(msg => {
    if (typeof msg.content === "string") return msg.content === "" ? undefined : msg
    if (!Array.isArray(msg.content)) return msg
    const filtered = msg.content.filter(p =>
      p.type === "text" ? p.text !== "" :
      p.type === "reasoning" ? (p.text.trim().length > 0 || p.providerOptions?.[ns]?.signature != null || p.providerOptions?.[ns]?.redactedData != null) :
      true)
    return filtered.length === 0 ? undefined : { ...msg, content: filtered }
  }).filter(m => m !== undefined)
}
```

**Apply.**
- Add an `npm` parameter to `ProviderTransform.message(msgs, providerID, modelID, npm?)` at transform.ts:133.
- Pass `model.npm` from prompt.ts:1029 and compaction.ts:410. The model object at prompt.ts:1001 already carries it.
- Run the filter before the `claude` branch.
- Port #12 together with this one.

**Failing test.** For npm `@ai-sdk/anthropic`, `message([{role:'assistant', content:[{type:'text',text:''},{type:'tool-call',toolCallId:'a',toolName:'x',input:{}}]}], 'anthropic','claude-x','@ai-sdk/anthropic')` should leave a content length of 1. `[{role:'assistant',content:[{type:'reasoning',text:'',providerOptions:{anthropic:{signature:'s'}}}]}]` should be kept.

### 7. Provider metadata and reasoning from another model are replayed, giving a 400 after a model switch or with a compaction/summary model — HIGH-MED

**Upstream commit:** `021e42c0bb1` (2026-01-20).

**Bug.** Assistant parts store the provider's metadata:
- Anthropic thinking `signature`;
- OpenAI `itemId` / `reasoningEncryptedContent`;
- Google `thoughtSignature`.

Sending that metadata or reasoning to a different provider or model gets a 400. Examples are "Invalid signature in thinking block" and "Item with id rs_... not found". Our compaction model cascade (compaction.ts:335-421) and the summary model (summary.ts:284) routinely differ from the model that produced the history.

**Ours.** `message-v2.ts` `toModelMessage` (L672-800) always passes `providerMetadata: part.metadata` (text and reasoning) and `callProviderMetadata: part.metadata` (tools). Reasoning is always sent as reasoning, and `toModelMessage(msgs)` has no target-model argument.

**Upstream logic** (upstream last message-v2.ts):

```ts
const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
// text:       { type:"text", text, ...(differentModel ? {} : { providerMetadata: part.metadata }) }
// reasoning:  differentModel ? (part.text.trim() ? { type:"text", text: part.text } : skip)
//                            : { type:"reasoning", text, providerMetadata: part.metadata }
// tool parts: ...(differentModel ? {} : { callProviderMetadata: part.metadata })
```

**Apply.**
- Add an optional `target?: { providerID: string; modelID: string }` argument to `MessageV2.toModelMessage`.
- Use it only when it is provided, so callers that pass nothing behave as today.
- Pass the target at:
  - prompt.ts (main loop) — the current model;
  - compaction.ts:350 — the cascade model actually used;
  - summary.ts:284 — the summary model.

**Failing test.**
- Take an assistant message `{providerID:'anthropic', modelID:'claude-sonnet-4'}` with a reasoning part `{text:'think', metadata:{anthropic:{signature:'sig'}}}` and a text part with metadata.
- `toModelMessage([...], { providerID:'openai', modelID:'gpt-5' })` should give no `providerOptions` on any part, and the reasoning should become a text part.

### 8. MCP `tools()` list call has no timeout or pagination guard, and the failed client is never closed — MED

**Upstream commits:**
- `f43b0d3afd`.
- `0efc334ff9` (#31442): `MAX_LIST_PAGES=1000` plus a duplicate-cursor guard.
- `3befd0c6c5` (#13229): parallel listing.
- `e5abe1e78b`: list timeout of 30 s.

**Bug.** `MCP.tools()` runs on every loop step (prompt.ts:1206).
- A server that stalls on `tools/list` hangs the step forever.
- A server that repeats `nextCursor` loops forever. The library's `tools()` (`@ai-sdk/mcp dist/index.js:2786-2792`) has no guard.
- Clients are listed one after another, so a slow server delays every step.

**Ours.** `mcp/index.ts:343` runs `await client.tools().catch(...)` sequentially, with no timeout. On failure, `:354` does `delete s.clients[clientName]` without `client.close()`, which leaks the stdio child or HTTP stream.

**Upstream logic** (upstream last `mcp/catalog.ts:18-36`):

```ts
async function paginate(list, items) { const out=[], seen=new Set(); let cursor
  for (let i=0;i<1000;i++){ const page=await list(cursor); out.push(...items(page))
    if (page.nextCursor===undefined) return out
    if (seen.has(page.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${page.nextCursor}`)
    seen.add(page.nextCursor); cursor=page.nextCursor }
  throw new Error("MCP list exceeded 1000 pages") }
```

**Apply** in `MCP.tools()`:
- Map the clients with `Promise.all`.
- For each client:
  - `defs = await paginate(c => client.listTools({ params: c ? { cursor: c } : undefined, options: { timeout: mcp.timeout ?? 30_000 } }), p => p.tools)`. `listTools` accepts `options` with a timeout, per dist:2640 / 2562.
  - Then `client.toolsFromDefinitions({ tools: defs })`.
- On error, `await client.close().catch(()=>{})` before deleting the client.

**Failing test.** A fake MCP client whose `listTools` always returns `{tools:[], nextCursor:'a'}` should make `MCP.tools()` reject or mark the server failed within 1 s. Today it never resolves.

### 9. MCP tool results with no `content`, resource content or `structuredContent` crash or are dropped — MED

**Upstream commits:** `8b9a85b7e7` (#7879), `dfb616f067` (#32244) and `94bc5662c4` (#57640).

**Bug.**
- `prompt.ts:1235` loops `for (const item of result.content)`. A result in the legacy `{ toolResult }` shape, or one with `content` undefined, throws `TypeError: result.content is not iterable`.
- A `structuredContent`-only result gives an empty output.
- `resource` and `resource_link` items are silently dropped, so the model sees an empty string.

**Ours.** `prompt.ts:1235-1251` handles only `text` and `image`; the comment there reads "Add support for other types if needed".

**Upstream logic** (upstream last `mcp/catalog.ts:66-80` plus the result formatter):

```ts
const content = Array.isArray(result.content) ? result.content : []
if (content.length === 0 && result.structuredContent != null) content.push({ type:"text", text: JSON.stringify(result.structuredContent) })
if (content.length === 0 && "toolResult" in result) content.push({ type:"text", text: JSON.stringify(result.toolResult) })
for (const item of content) {
  if (item.type === "text") text.push(item.text)
  else if (item.type === "image") attach(item.mimeType, item.data)
  else if (item.type === "resource") item.resource.text ? text.push(item.resource.text) : item.resource.blob && attach(item.resource.mimeType ?? "application/octet-stream", item.resource.blob)
  else if (item.type === "resource_link") text.push(`Resource: ${item.name ?? ""} ${item.uri}`)
}
if (result.isError) output = text.filter(t => t.trim()).join("\n\n") || "MCP tool returned an error"
```

**Apply.** Replace the loop at prompt.ts:1235, and also return the normalized `content` (:1252).

**Failing test.** Wrap a fake `execute` that resolves `{ structuredContent:{a:1} }`, which has no `content`.
- Today the wrapper throws a TypeError.
- After the fix, the output should equal `'{"a":1}'`.

### 10. An invalid MCP URL, or an exception during create, removes the server silently — MED

**Upstream commits:** `ea89925042` (#25019) and `91073360c6` (#31595).

**Bug.** `new URL(mcp.url)` (mcp/index.ts:188, :196) throws synchronously. `create()` rejects, and `:106` `create(key, mcp).catch(() => undefined)` drops it. The server then never appears in `status`, with no error and no log, so the user cannot tell why the tools are missing.

**Upstream logic** (upstream last `mcp/index.ts:123-125`):

```ts
function remoteURL(v: string) { if (URL.canParse(v)) return new URL(v) }
const url = remoteURL(mcp.url); if (!url) return { status: { status:"failed", error:`Invalid MCP URL: ${mcp.url}` } }
```

Upstream also turns any exception during create into `{ status:{ status:'failed', error: err.message } }`.

**Apply.**
- Make `:106` `.catch(e => ({ status:{ status:'failed', error: e instanceof Error ? e.message : String(e) } }))` and record the status.
- Add the `URL.canParse` check before :184.

**Failing test.** Config `{ type:'remote', url:'not a url' }` should give `(await MCP.status())[key]` as `{status:'failed'}`. Today it is `undefined`.

### 11. An MCP server without the `tools` capability (resources or prompts only) is marked failed — MED

**Upstream commits:** `b5cb9aae7f` (#31271) and `fbf5f164d9` (#55474).

**Bug.** @ai-sdk/mcp's `assertCapability` throws `MCPClientError("Server does not support tools")` (dist:2540-2542). `mcp/index.ts:343-354` then marks the server `failed` and deletes the client, which also loses its instructions.

**Upstream logic.** When `err.message` includes `"does not support tools"`, treat the result as `{}` tools and keep the client connected.

**Apply.** In the `.catch` at :343, `if (/does not support tools/i.test(e?.message)) return {}` before marking failed. Apply the same check to the listing in #8.

**Failing test.** A fake client whose `tools()` rejects with `new Error('Server does not support tools')` should leave the status `connected`, and `MCP.tools()` should return `{}` for it.

### 12. Signed reasoning plus empty text: keep the block by sending `" "` — MED (port with #6)

**Upstream commit:** `233fc5b910` (2026-05-07, #21370).

**Bug.** Anthropic requires the assistant turn that carries a signed thinking block to keep its structure. When #6 removes the only empty text part, the thinking block can end up alone, or the message ordering breaks. Anthropic then returns 400 "thinking blocks ... cannot be modified".

**Upstream logic.** In `toModelMessage`, if the assistant message has reasoning with `metadata.anthropic.signature` and a text part is `""`, emit `" "` instead of dropping it.

**Apply.** In `message-v2.ts` assistant text handling (L672-800), use `text: part.text === '' && hasSignedReasoning ? ' ' : part.text`.

**Failing test.** An assistant message with reasoning `{metadata:{anthropic:{signature:'s'}}}` and text `''`, run through `toModelMessage` and then `ProviderTransform.message(...anthropic)`, should still contain a text part `' '`.

### 13. `applyCaching` overwrites existing providerOptions with a shallow spread and loses signatures — MED

**Upstream commit:** `087d7da14d` (#10323).

**Bug.** `transform.ts:116-119` does `lastContent.providerOptions = { ...lastContent.providerOptions, ...providerOptions }` (and `:124-127` does the same for the message). The `anthropic` key is replaced wholesale with `{cacheControl}`.
- When the last content part is a reasoning part, its `providerOptions.anthropic.signature` is lost.
- This applies to OpenRouter, opencode and other non-`anthropic` providerIDs that route Claude (`shouldUseContentOptions` is true).
- The result is a 400 "thinking block signature missing/invalid".

**Upstream logic** (upstream last transform.ts:364, :369):

```ts
lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
```

`mergeDeep` comes from `remeda`, which we already import at transform.ts:2.

**Failing test.** `message([{role:'user',content:'x'},{role:'assistant',content:[{type:'reasoning',text:'t',providerOptions:{anthropic:{signature:'s'}}}]}], 'openrouter', 'anthropic/claude-sonnet-4')` should keep `content[0].providerOptions.anthropic.signature === 's'`. Today it is undefined.

### 14. Bedrock cache point type, and Bedrock needs message-level options — MED (Bedrock only)

**Upstream commits:** `ca5e85d6ea` (#11664) and `024979f3fd` (#18959).

**Bug.** `transform.ts:99-101` sends `bedrock: { cachePoint: { type: 'ephemeral' } }`. Bedrock only accepts `'default'`, so it either 400s or ignores caching. Bedrock also requires the cache point at message level; we put it on the last content part (`shouldUseContentOptions` is true when providerID !== 'anthropic').

**Upstream logic** (L335-353):
- `bedrock: { cachePoint: { type: "default" } }`.
- `useMessageLevelOptions = providerID === "anthropic" || providerID.includes("bedrock") || npm === "@ai-sdk/amazon-bedrock"`.

**Apply** at transform.ts:99 and :107-110. This needs the `npm` parameter from #6.

**Failing test.** For providerID `amazon-bedrock` and a Claude model, the last message should get `providerOptions.bedrock.cachePoint.type === 'default'` at message level, not on the part.

### 15. Moonshot/Kimi tool schemas with `$ref` siblings or tuple `items` are rejected, and MCP schemas skip `schema()` — MED

**Upstream commits:** `528fb1d404` (#24730) and `b7b734f51f` (#11984).

**Bug.**
- Moonshot validates the JSON Schema strictly.
- It rejects `{ $ref, description }` siblings and tuple-style `items: [...]`.
- A single offending MCP tool schema makes every request 400.
- This fork uses Kimi K2.5 heavily (#194).

**Ours.**
- `transform.ts:283-310` `schema()` is a no-op.
- MCP tools (prompt.ts:1206-1258) never pass through `ProviderTransform.schema`; only built-in tools do, at prompt.ts:1164.

**Upstream logic** (upstream last transform.ts:1467-1483):

```ts
if (providerID === "moonshotai" || modelID.toLowerCase().includes("kimi")) {
  const fix = (o) => o === null || typeof o !== "object" ? o : Array.isArray(o) ? o.map(fix)
    : ("$ref" in o && typeof o.$ref === "string") ? { $ref: o.$ref }
    : (r => (Array.isArray(r.items) && (r.items = r.items[0] ?? {}), r))(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fix(v)])))
  schema = fix(schema)
}
```

**Apply.**
- Implement this in `schema()`.
- In the MCP loop, `item.inputSchema = jsonSchema(ProviderTransform.schema(providerID, modelID, asSchema(item.inputSchema).jsonSchema))`, the same as the built-in tools.

**Failing test.** `schema('moonshotai','kimi-k2.5',{type:'object',properties:{a:{$ref:'#/$defs/A',description:'d'}, b:{type:'array',items:[{type:'string'}]}}})` should give `a` equal to `{ $ref }` and `b.items` equal to `{type:'string'}`.

### 16. Tool-call input that is not an object (an invalid or repaired call) is stored raw, and Gemini/Vertex 400 on every later turn — MED

**Source.** Upstream last `session/processor.ts:336`, part of the tool-call state rework `bd53b651a3` (2026-04-09, #21709).

**Bug.** When `parseToolCall` cannot parse the arguments and `repairToolCall` (prompt.ts:966-987) routes the call to `invalid`, AI SDK 7 returns a `tool-call` with `invalid:true` and `input` set to the RAW STRING.
- We persist it as `state.input`.
- On replay, `@ai-sdk/google` sends `functionCall.args: "<string>"` and gets a 400. Anthropic and Bedrock wrap non-objects themselves.
- The doom-loop comparison also uses this raw value.

**Ours** (`processor.ts:194-206`): `state: { status: 'running', input: value.input, ...}`.

**Upstream logic:**

```ts
const input = isRecord(value.input) ? value.input : { value: value.input }
```

**Apply.** Use that `input` at processor.ts:202 and :226.

**Failing test.**
- Feed the processor a stream containing `tool-input-start {id:'a', toolName:'invalid'}`, then `tool-call {toolCallId:'a', toolName:'invalid', input:'{"bad', invalid:true}`.
- The stored `state.input` should equal `{value:'{"bad'}`. Today it is the raw string.

### 17. Interrupted tools: no `interrupted` marker, start time overwritten, open text/reasoning not finalized — MED (prerequisite of #3)

**Upstream commits:**
- `e76cf967e6` (2026-05-14, #27254);
- `748fcb7ebd` (#26178);
- `c29392d0857` (2026-04-09, #21598);
- `58a99916bb` (#21691).

**Bug.** Cleanup (`processor.ts:739-760`) marks pending and running tools as `error` with `time:{start: Date.now(), end: Date.now()}`.
- The real start time and any partial output in `metadata` are lost, because `...part.state` keeps `metadata` but not output.
- No marker tells "aborted" apart from "tool failed", which #3 needs.
- Open text and reasoning parts are left with no `time.end`.

**Upstream logic** (upstream last processor.ts:554-597):

```ts
const end = Date.now()
if (currentText) { currentText.time = { start: currentText.time?.start ?? end, end }; await updatePart(currentText) }
// same for open reasoning parts
for (const part of parts) if (part.type==="tool" && part.state.status!=="completed" && part.state.status!=="error")
  await updatePart({ ...part, state: { ...part.state, status:"error", error:"Tool execution aborted",
    metadata: { ...part.state.metadata, interrupted: true }, time: { start: part.state.time?.start ?? end, end } } })
```

**Apply** at processor.ts:739-760. `currentText` and the reasoning map are in scope in `process()`.

**Failing test.** Make a processor stream throw after `tool-call`. The persisted tool part should have `state.metadata.interrupted===true`, and its `time.start` should equal the running start, not the cleanup time.

### 18. Retry classification gaps — MED

**Upstream sources:**
- upstream last `session/retry.ts:68-152`;
- `837037cd04` (2026-01-27, #10590);
- `334ab4707c` (2026-04-23, #24063);
- `7123aad5a8` (2026-03-25, #19104).

**Bugs:**
- (a) An APIError with status >= 500 that the SDK marks `isRetryable:false` is not retried. Custom proxies return 520/522/524.
- (b) An `UnknownError` whose message says "rate limit", "too many requests" or "rate increased too quickly", or whose JSON reports a `too_many_requests` type or an `exhausted`/`unavailable` code, is not retried. Plain-text proxies and Vertex `RESOURCE_EXHAUSTED` are examples.
- (c) An OpenAI 404 on the Responses API ("Item with id ... not found" race) is not retried.
- (d) Bun's `ZlibError` (a truncated gzip body) is classified as Unknown and not retried.

**Ours.** `processor.ts:615-616` uses `error?.name === 'APIError' && error.data.isRetryable` only.

**Upstream logic:**

```ts
if (APIError.isInstance(err)) { if (!err.data.isRetryable && !(status >= 500)) return no }
const msg = err.data?.message?.toLowerCase?.() ?? ""
if (msg.includes("rate increased too quickly") || msg.includes("rate limit") || msg.includes("too many requests")) return yes
const j = tryJSON(err.data?.message); if (j?.type==="error" && j.error?.type==="too_many_requests") return yes
if (typeof j?.code==="string" && (j.code.includes("exhausted")||j.code.includes("unavailable"))) return yes
if (j?.type==="error" && typeof j.error?.code==="string" && j.error.code.includes("rate_limit")) return yes
// provider/error.ts: providerID.startsWith("openai") && statusCode===404 → isRetryable:true
// ZlibError (name==="ZlibError" || code starts "Z_") → APIError isRetryable:true
```

**Apply.**
- Widen `isRetryableAPIError` at processor.ts:615, or turn these matching Unknowns into `APIError{isRetryable:true}` in `fromError`. The second option keeps `SessionRetry.shouldRetry` budgets.
- Do NOT retry 5xx when #290's `isUnreachableNetworkError` holds (message-v2.ts:965 already guards this).

**Failing tests:**
- `fromError(new APICallError({statusCode:524, isRetryable:false,...}))` should be retried by the processor, or carry `isRetryable===true`.
- `fromError(new Error('Rate limit exceeded, please slow down'))` should be retryable. Today it is `UnknownError`.
- An OpenAI 404 `APICallError` should be retryable.

### 19. API error messages are raw SDK text with no body detail, and HTML bodies are dumped — LOW-MED

**Upstream commits:** `4fd576f3af` (2025-12-18) and `6b7e6bde4d` (2026-03-01, #15407).

**Bug.** `message-v2.ts:959` uses `e.message`. That is often "Bad Request" or empty, so the actual reason in `responseBody` is hidden in logs and the CLI output. This hurts every failure diagnosis.

**Upstream logic** (`provider/error.ts message()`):

```ts
let m = e.message || e.responseBody || STATUS_CODES[e.statusCode] || "Unknown error"
const body = tryJSON(e.responseBody)
if (body) { const detail = body.message || body.error?.message || (typeof body.error === "string" ? body.error : undefined); if (detail && !m.includes(detail)) m = `${m}: ${detail}` }
else if (/^\s*<!doctype|<html/i.test(e.responseBody ?? "")) m = e.statusCode===401 ? "Unauthorized: request was blocked by a gateway or proxy..." : e.statusCode===403 ? "Forbidden: ..." : m
else if (e.responseBody && !m.includes(e.responseBody)) m = `${m}: ${e.responseBody}`
```

**Apply** in `fromError` at message-v2.ts:959.

**Failing test.** `fromError(new APICallError({message:'Bad Request', statusCode:400, responseBody:'{"error":{"message":"tools.0.name invalid"}}',...})).data.message` should contain `'tools.0.name invalid'`.

### 20. Tool call or result without a preceding `tool-input-start` is dropped — LOW-MED

**Upstream commit:** `bd53b651a3` (2026-04-09, #21709), `ensureToolCall`.

**Bug.**
- `processor.ts:194-196` acts only if `toolcalls[value.toolCallId]` exists.
- `:232-249` does the same for `tool-result`.
- Provider-executed tools (Google `code_execution`, Anthropic server tools) and some openai-compatible adapters emit `tool-call` with no `tool-input-start`.
- The call is never persisted, so the model's next turn references a missing call, or the result is lost.

**Upstream logic** (upstream last processor.ts:123-258):

```ts
function ensureToolCall(v) {
  if (toolcalls[v.toolCallId]) return toolcalls[v.toolCallId]
  return toolcalls[v.toolCallId] = await updatePart({ id: ascending("part"), messageID, sessionID, type:"tool", tool: v.toolName, callID: v.toolCallId,
    state: { status:"pending", input:{}, raw:"" }, metadata: v.providerExecuted ? { providerExecuted: true } : undefined })
}
```

It is called first in both `tool-call` and `tool-result`.

**Failing test.** A stream with only `tool-call {toolCallId:'x', toolName:'read', input:{}}` should produce a persisted tool part. Today there are no parts.

### 21. `cancel()` rejects queued callers with `undefined` and leaves the status busy when there is no match — LOW

**Upstream commit:** `6c9b2c37a5` (2026-02-01).

**Bug.**
- `prompt.ts:283` calls `item.reject()` with no reason. Callers get `undefined` as the error, and `continuous-mode.js:598-613` prints `errorText(undefined)`.
- `:281` `if (!match) return;` does not set idle, so a session whose state was already cleared stays `busy` in status.

**Upstream logic:**
- `item.reject(new DOMException("Aborted", "AbortError"))`.
- `if (!match) { SessionStatus.set(sessionID, { type: "idle" }); return }`.

**Failing test.** Queue a second `prompt()` while the loop is busy, then call `cancel()`. The rejection should be `instanceof DOMException` with `name==='AbortError'`.

### 22. User message whose parts all convert to nothing becomes `content: []`, and Anthropic/Bedrock 400 — LOW

**Upstream commit:** `13f89fdb8f` (2025-11-28, #4811).

**Bug.** `message-v2.ts:672-680` skips only `msg.parts.length === 0`. A user message whose parts are all ignored or synthetic-filtered still produces a UI message with zero parts. AI SDK 7 `convertToModelMessages` then pushes `{role:'user', content: []}`. #6 covers this for Anthropic/Bedrock only; fixing it here covers every provider.

**Upstream logic.** `return convertToModelMessages(result.filter(m => m.parts.some(p => p.type !== "step-start")))`.

**Apply** at message-v2.ts:796.

**Failing test.** A user message with a single `{type:'text', ignored:true}` part should give `toModelMessage` output with no element whose content is `[]`.

### 23. MCP dispose leaves orphaned grandchildren — LOW-MED

**Upstream commit:** `c4c0b23bff` (#15516).

**Bug.** Servers launched via `npx`/`uvx`/`sh -c` spawn the real server as a grandchild. `client.close()` kills only the direct child, so the grandchildren keep running, leaking processes and holding ports. This hurts in continuous mode.

**Ours.** `mcp/index.ts:134-146` dispose does only `client.close()`.

**Upstream logic** (upstream last mcp/index.ts:418-441): before closing, walk the descendants with BFS using `pgrep -P <pid>` (skip on win32), close the client, then `process.kill(pid, 'SIGTERM')` each descendant, ignoring errors. The pid comes from the stdio transport (`transport.pid` / the `_process.pid` of the SDK StdioClientTransport).

**Failing test** (Linux). Use a local server `sh -c 'sleep 1000 & node server.js'`. After `MCP` dispose, `pgrep -f "sleep 1000"` should find nothing.

### 24. Retry delay can exceed the setTimeout limit (2^31-1 ms), which fires immediately and makes a hot retry loop — LOW (latent)

**Source.** Upstream last `retry.ts:29-33`, `RETRY_MAX_DELAY = 2_147_483_647` with `cap()`.

**Ours.**
- `retry.ts:211-268` returns `addJitter(retryAfterMs)`, bounded only by `retryTimeout`.
- The default `retryTimeout` is 604800 s, about 6.0e8 ms, which is safe.
- A user-set `retryTimeout` above about 24.8 days, together with a large `retry-after`, overflows. Bun/Node clamp it to 1 ms and warn.

**Apply.** In `retry.ts`, wrap every return of `delay`, `socketErrorDelay` and `timeoutDelay` in `Math.min(x, 2_147_483_647)`.

**Failing test.** With `config.retryTimeout = 1e7` seconds, `SessionRetry.delay(apiErrorWithHeaders({'retry-after':'3000000'}), 1)` should be `<= 2147483647`. Today it is about 3.0e9.

### 25. Reasoning tokens are counted twice in cost — LOW

**Upstream commit:** `280eb16e77` (2026-04-04, #21047).

**Bug.** In AI SDK 7, `outputTokens` already includes reasoning. `session/index.ts:764` stores the full `output`, and :765 stores `reasoning` as well. Cost at :786-807 charges both at the output rate, so reasoning models are overbilled by the reasoning amount. The context checks use `output` only (compaction.ts:143), so this affects cost only.

**Upstream logic.** `output: outputTokens - reasoningTokens`.

**Apply** at index.ts:764 as `Math.max(0, output - reasoningTokens)`.

**Failing test.** `Session.getUsage({ usage:{ inputTokens:10, outputTokens:100, reasoningTokens:60 }, model:{cost:{input:0,output:1}} })` should give cost `100/1e6`. Today it is `160/1e6`.

---

## Our own bugs found during the review (not upstream commits; worth fixing alongside)

1. **The MCP tool timeout does not cancel the request** (`prompt.ts:1218`). `withTimeout(execute(args, opts), timeout)` rejects, but the MCP request stays pending and the server keeps working. Pass `{ ...opts, abortSignal: AbortSignal.any([opts.abortSignal, AbortSignal.timeout(timeout)].filter(Boolean)) }` instead.
2. **`getToolTimeout` splits on the first `_`** (`mcp/index.ts:396-402`). For a server named `my_server`, per-tool timeouts never match. Look up the longest configured server prefix instead.
3. **Dead branch in `maxOutputTokens`.** prompt.ts:1001 passes `providerID` where `npm` is expected, so the `@ai-sdk/anthropic` thinking branch at transform.ts:263 never runs. The thinking budget plus maxOutputTokens can then exceed the model cap and cause a 400.

---

## Checked and rejected

### ALREADY-HAVE

| Upstream change | Where we already have it |
|---|---|
| `4cb29967f6` (#17823) transform for the compaction request | compaction.ts:405-417 middleware calls `ProviderTransform.message` |
| `b157fd10a7` (#6383) step-start-only messages | AI SDK 7 `convertToModelMessages` drops empty assistant content |
| Proactive overflow, disable-autocompact and token-estimate fallback | compaction.ts:123-183 (#249) |
| JSONParseError skip | processor.ts:273-290 (#169) |
| Usage TypeError retry | processor.ts:594-610 (#264) |
| Unknown-finish tool-call check | prompt.ts:341+ (#194/#239) |
| Socket and timeout retries; retry-after-ms / seconds / date parsing | retry.ts:150-195 |
| Stream chunk timeout (`69ddc91c35`, `8c53b2b470`) | our `streamChunkTimeoutMs` |
| MCP abort forwarded (`79cff288a6`) | — |
| MCP isError mapped (`dfb616f067` isError part) | prompt.ts:1256 |
| `1b096b4148`, `25cb2be619`, `be227503af`, `75166a1961`, `dd1f981d23` | — |
| `4a56491e42`, `9eefcd1b41` | read.ts:69-104 |
| OpenAI itemId stripping (`92931437c4`, `d47510785a`, `40836e9683`, `7c3eeeb0fa`, `a86ecf3bba`) | @ai-sdk/openai 4.0.100 |

### NOT-APPLICABLE

- **Doom-loop permission ask:** permission UX. Ours has detection with an empty body at processor.ts:226-229, by design.
- **`4f1a9d7aef` (#33142):** agent step limits are a feature.
- **`563177c6ac` (#25241):** we never emit media in tool-result content.
- **`a45841396f` (#12369):** it would leave queued callers hanging, and our callers already catch.
- **Gemini schema sanitizers:** @ai-sdk/google 4.0.103 sends `parametersJsonSchema`.
- **Azure defaults:** `c5deeee8c7`, `cb18f2ef40`, `a740d2c667`, `9675579796`.
- **`cc818f8032`, `0c32afbc35`, `870c38a6aa`, `20088a87b0`, `43354eeabd`:** these are for providers or options we do not configure.
- **`348a84969d`:** superseded by `5940304098`.
- **Reverted pairs:** `42173bca4b`/`a763a14d44`, `39a504773c`/`5588453cbe`, `9258e8ca86`/`3a2ff11be8`.
- **Features:** `18d3c054a3`, `83bb216486`, `7d1733c752`, `0e1a8a1839`, `213ff3f2d7`, `421a04f5fd` (MCP retry).
- **MCP progress and timeout-reset** (`a98d5732c0`, `1aae92c42a`, `bfdbf43ef8`): needs the raw MCP SDK `onprogress`, which @ai-sdk/mcp does not expose.
- **`174ab58343`:** MCP prompts and resources are unused.
- **`155bc7df75`, `79d6b10d7c`:** do not apply to the @ai-sdk/mcp client.
- **DeepSeek `reasoning_content` via openai-compatible** (`86715fecc4` #24180, `923af96d26` #24146): only matters if a DeepSeek model is routed through `@ai-sdk/openai-compatible`; @ai-sdk/deepseek handles it natively. Revisit only if such a config exists.
- **Devstral id normalisation** (`95bf01a757` #11412, `babe5070e2` #33109): one-line extension of transform.ts:33 (`|| modelID.toLowerCase().includes('devstral')`). Trivial; port if Devstral is used.
- **providerOptions key `providerID.split('.')[0]` / `sdkKey(npm)`** (`a12333310f` #25145): our `options()` only emits OpenAI keys, which are already mapped for `@ai-sdk/openai`/`azure` (transform.ts:230-235). The impact is limited to user config for custom IDs on `@ai-sdk/google`.
- **MCP minor:**
  - `80e1173ef7` (#8253) close the old client in `add()`: `MCP.add` has no callers.
  - `2fb7985bb7` (#52418) error text in the status: our status already stores `e.message` (mcp/index.ts:350).
- **Not verified** (left out): `025a6392ce` (vertex toolStreaming default), `c361c2953f`, `1721c6efdf`, `5f57cee8e4`, `694695050a` (keep the running-state input when the result lacks it: a small `value.input ?? match.state.input` at processor.ts:240, low value).

---

## Suggested grouping for implementation

| Group | Items |
|---|---|
| A — error classification | 1, 2, 18, 19 (all in `message-v2.ts fromError`, plus processor/prompt/compaction wiring for 1) |
| B — loop | 3, 17, 21 (`prompt.ts`, `processor.ts` cleanup) |
| C — replay transforms | 5, 6, 12, 13, 14, 15, 7, 22 (`transform.ts` plus the `toModelMessage` target-model arg; needs the `npm` param) |
| D — tool-call stream | 16, 20 (`processor.ts`) |
| E — MCP | 4, 8, 9, 10, 11, 23, plus own-bugs 1-2 (`mcp/index.ts`, prompt.ts:1206-1258) |
| F — small | 24, 25, own-bug 3 |
