# Case Study: Issue #204 — `agent --model opencode/kimi-k2.5-free --verbose` fails

## Summary

When running `agent --model opencode/kimi-k2.5-free --verbose`, the agent fails with
"Provider returned zero tokens with unknown finish reason" error. Even with `--verbose` enabled,
the raw HTTP response body is not logged, making it impossible to diagnose the root cause from
the logs alone.

## Timeline of Events

1. **2026-02-23T13:22:37Z** — `solve` invoked with `--model kimi-k2.5-free --verbose`
2. **13:23:17Z** — Agent started with `opencode/kimi-k2.5-free` model
3. **13:23:18Z** — Provider `opencode` initialized, model `kimi-k2.5-free` resolved
4. **13:23:19Z** — Initial prompt sent to opencode API
5. **13:23:25Z** — Response starts streaming — partial output visible
6. **13:23:26Z** — `finish-step` event arrives with:
   - `requestedModelID`: `kimi-k2.5-free`
   - `respondedModelID`: `moonshotai/kimi-k2.5` (mismatch!)
   - `rawFinishReason`: `undefined`
   - `rawUsage`: `{"inputTokenDetails":{},"outputTokenDetails":{}}`
7. **13:23:26Z** — Session aborts with "Provider returned zero tokens with unknown finish reason"

## Affected Run

- **Log file**: `solution-draft-log.txt` (downloaded from [gist](https://gist.github.com/konard/4595ac2d4453897ee4065007ecb07705))
- **Model**: `opencode/kimi-k2.5-free`
- **Provider**: OpenCode (uses `@ai-sdk/openai-compatible` bundled SDK)
- **Error line**: `1493–1525` in log — `session.error` published with `UnknownError`
- **Error line**: `1634–1646` — outer runner detects agent error, `exitCode: 0`, `errorDetectedInOutput: true`

## Root Cause Analysis

### Issue 1: Response body not logged in verbose mode (PRIMARY)

The `--verbose` flag adds HTTP request/response logging in `provider.ts` (`getSDK()` function).
However, it only logs:
- Request: URL, method, sanitized headers, body preview ✅
- Response: status code, status text, headers, duration ✅
- Response **body**: **NOT LOGGED** ❌

For SSE streaming responses (which is how LLM providers work), the response body is consumed by
the AI SDK layer and is not available after-the-fact. Without logging the raw SSE stream, it is
impossible to know:
- Did the provider return a well-formed SSE response?
- Was there an error message in the body before the stream ended?
- Were there malformed SSE events (missing blank lines)?
- Did the response body contain `(no content)` tokens?

### Issue 2: Model ID mismatch

The `requestedModelID` is `kimi-k2.5-free` but `respondedModelID` is `moonshotai/kimi-k2.5`.
This suggests the OpenCode API maps `kimi-k2.5-free` to the actual MoonshotAI model ID internally.
The mismatch itself is not an error — it's normal aliasing — but it adds confusion when debugging.

### Issue 3: Zero usage data in opencode provider metadata

The `providerMetadata` shows `{"opencode":{}}` (empty object). The OpenCode provider does not
return usage information via its metadata channel. When the AI SDK receives a stream with no
usage data and `undefined` finishReason, it defaults to zero tokens and `unknown` finish reason.

### Issue 4: OpenCode free tier limitations

Based on external research, the `kimi-k2.5-free` model via OpenCode Zen free tier has known issues:
- **SSE stream corruption**: SSE chunks are occasionally concatenated without blank-line delimiters,
  violating the SSE spec and causing `AI_JSONParseError` (also seen in KiloCode Issue #5875)
- **`(no content)` tokens**: Model outputs a text content block with value `"(no content)"` before
  making tool calls when run via vLLM/sglang (HuggingFace Discussion #18)
- **JSON Schema errors**: When MCP tools are involved, the model may throw JSON Schema validation
  errors (OpenCode Issue #11591)
- **`MODEL_NO_ASSISTANT_MESSAGES`**: Model sometimes returns completely empty assistant responses
  (KiloCode Issue #5724)
- **reasoning_content required**: When thinking mode is enabled, Kimi K2.5 requires a
  `reasoning_content` field in every tool-call message (OpenCode Issue #10996)

Without the response body logged, we cannot determine which of these specific issues occurred.

## Evidence from Log

```
Line 1407: "requestedModelID": "kimi-k2.5-free"
Line 1408: "respondedModelID": "moonshotai/kimi-k2.5"
Line 1409: "rawFinishReason": "undefined"
Line 1410: "rawUsage": "{\"inputTokenDetails\":{},\"outputTokenDetails\":{}}"
Line 1411: "providerMetadata": "{\"opencode\":{}}"
```

The empty `providerMetadata` and zero usage strongly indicate the provider returned either:
1. An empty streaming response (no SSE events with actual content)
2. A malformed SSE response that the AI SDK failed to parse

**Key gap**: No HTTP response body is logged, so we cannot confirm which of these occurred.

## Known External Issues

| Issue | Source | Status |
|-------|--------|--------|
| SSE stream corruption via gateway | [KiloCode #5875](https://github.com/Kilo-Org/kilocode/issues/5875) | Open |
| `(no content)` tokens in vLLM | [HuggingFace Discussion #18](https://huggingface.co/moonshotai/Kimi-K2.5/discussions/18) | Open |
| Kimi K2.5 JSON Schema errors | [OpenCode #11591](https://github.com/anomalyco/opencode/issues/11591) | Open |
| MODEL_NO_ASSISTANT_MESSAGES | [KiloCode #5724](https://github.com/Kilo-Org/kilocode/issues/5724) | Open |
| reasoning_content required for tool calls | [OpenCode #10996](https://github.com/anomalyco/opencode/issues/10996) | Open |

## Solution Implemented

### 1. Response body logging in verbose mode

Added response body streaming/logging to the existing verbose HTTP logging in `provider.ts`.

**Approach**: When `--verbose` is enabled and the response has a body:
- For non-streaming responses (JSON): buffer and log the full body, then reconstruct the Response
- For streaming responses (SSE/event-stream): use `ReadableStream.tee()` to split the stream
  into two: one for logging (consumed asynchronously) and one passed to the AI SDK unchanged
- Body is truncated at 4000 chars to prevent excessive log output
- Logged as `'HTTP response body'` message after the status/headers log

This gives us the raw SSE events, making it possible to see exactly what the provider returned
and diagnose issues like empty streams, malformed events, or error messages.

### 2. Case study analysis

Compiled this analysis from:
- Log file from gist (see `solution-draft-log.txt`)
- Codebase analysis of `provider.ts`, `session/processor.ts`, `session/prompt.ts`
- External research on Kimi K2.5 known issues

## Data Files

- `solution-draft-log.txt` — Full log from the failing run (downloaded from gist)
- `logs.md` — Key log excerpts and error sequences
- `README.md` — This case study analysis

## Recommendations

1. **Log response body in verbose mode** (implemented) — provides the missing data
2. **Log to file by default** — consider also writing verbose output to a dedicated debug log file
   so that the body of a large streaming response doesn't flood the terminal
3. **Report upstream**: The empty SSE response from opencode/kimi-k2.5-free may be a provider-side
   issue. After collecting response body data with the new logging, consider reporting to
   https://github.com/anomalyco/opencode if confirmed
4. **Handle empty streaming responses gracefully**: Instead of throwing UnknownError for zero tokens,
   consider a more descriptive error message that includes what was actually received
