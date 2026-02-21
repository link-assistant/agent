# Issue 200 - Case Study Logs

Error logs extracted from PR comments showing `@link-assistant/agent` failures related to model resolution.

---

## Case 1: PR #851 (godot-topdown-MVP) - Comment 3928926678

- **Source:** https://github.com/Jhon-Crow/godot-topdown-MVP/pull/851#issuecomment-3928926678
- **Date:** 2026-02-19T18:01:02Z
- **Model requested:** `kilo/glm-5-free` (resolved to provider `opencode`, modelID `kimi-k2.5-free`)
- **Solve version:** 1.24.0

### Error

```
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: {
  providerID: "opencode",
  modelID: "kimi-k2.5-free",
},
    at getModel (/home/hive/.bun/install/global/node_modules/@link-assistant/agent/src/provider/provider.ts:1314:13)
```

### Log context

```
"level": "error",
"timestamp": "2026-02-19T18:01:02.410Z",
"service": "session.prompt",
"providerID": "opencode",
"modelID": "kimi-k2.5-free",
"error": "ProviderModelNotFoundError",
"message": "Failed to initialize specified model - NOT falling back to default (explicit provider specified)"
```

---

## Case 2: PR #850 (godot-topdown-MVP) - Comment 3928860371

- **Source:** https://github.com/Jhon-Crow/godot-topdown-MVP/pull/850#issuecomment-3928860371
- **Date:** 2026-02-19T17:48:53Z
- **Model requested:** `kimi-k2.5-free`
- **Solve version:** 1.24.0

### Error

```
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: {
  providerID: "opencode",
  modelID: "kimi-k2.5-free",
},
    at getModel (/home/hive/.bun/install/global/node_modules/@link-assistant/agent/src/provider/provider.ts:1314:13)
```

### Log context

```
"level": "error",
"timestamp": "2026-02-19T17:48:53.464Z",
"service": "session.prompt",
"providerID": "opencode",
"modelID": "kimi-k2.5-free",
"error": "ProviderModelNotFoundError",
"message": "Failed to initialize specified model - NOT falling back to default (explicit provider specified)"
```

---

## Case 3: PR #424 (rdf-grapher) - Comment 3926248544

- **Source:** https://github.com/bpmbpm/rdf-grapher/pull/424#issuecomment-3926248544
- **Date:** 2026-02-19T10:23:04Z
- **Model requested:** unknown (provider: unknown)
- **Solve version:** not specified in error

### Error

```
UnknownError: Provider returned zero tokens with unknown finish reason.
Requested model: unknown (provider: unknown). Responded model: unknown.
This usually indicates the provider failed to process the request.
Check provider status, model availability, and API keys.
```

### Log context

```
"level": "error",
"timestamp": "2026-02-19T10:23:04.906Z",
"service": "session.prompt",
"sessionID": "ses_38a93604cffeLXaBjvFzD33Bt6",
"finishReason": "unknown",
"message": "Provider returned zero tokens with unknown finish reason. Requested model: unknown (provider: unknown). Responded model: unknown. This usually indicates the provider failed to process the request. Check provider status, model availability, and API keys."
```

### Failure summary from solve.mjs

```json
{
  "type": "error",
  "exitCode": 0,
  "errorDetectedInOutput": true,
  "errorType": "AgentError",
  "errorMatch": "Provider returned zero tokens with unknown finish reason. Requested model: unknown (provider: unknown). Responded model: unknown. This usually indicates the provider failed to process the request. Check provider status, model availability, and API keys.",
  "sessionId": null,
  "limitReached": false,
  "limitResetTime": null
}
```

Full failure log gist: https://gist.githubusercontent.com/konard/33db31f02b8f940801edf445f03ccef0/raw/fecaf1cbff7a44cdb20f42163ed1be970fa8938a/solution-draft-log-pr-1771496586349.txt

---

## Case 4: PR #780 (godot-topdown-MVP) - Comment 3938448007

- **Source:** https://github.com/Jhon-Crow/godot-topdown-MVP/pull/780#issuecomment-3938448007
- **Date:** 2026-02-21T08:27:20Z
- **Model requested:** `kimi-k2.5-free`
- **Solve version:** 1.24.3

### Error

```
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: {
  providerID: "opencode",
  modelID: "kimi-k2.5-free",
  suggestion: "Model \"kimi-k2.5-free\" not found in provider \"opencode\". Available models: trinity-large-preview-free, glm-5-free, gpt-5-nano, big-pickle, minimax-m2.5-free.",
},
    at getModel (/home/hive/.bun/install/global/node_modules/@link-assistant/agent/src/provider/provider.ts:1433:13)
```

### Log context

```
"level": "error",
"timestamp": "2026-02-21T08:27:20.789Z",
"service": "session.prompt",
"providerID": "opencode",
"modelID": "kimi-k2.5-free",
"error": "ProviderModelNotFoundError",
"message": "Failed to initialize specified model - NOT falling back to default (explicit provider specified)"
```

### Available models in provider "opencode" at time of failure

- `trinity-large-preview-free`
- `glm-5-free`
- `gpt-5-nano`
- `big-pickle`
- `minimax-m2.5-free`

Note: `kimi-k2.5-free` is confirmed available on OpenCode (https://opencode.ai/docs/zen) and in models.dev/api.json. The absence from the available models list at time of failure was due to temporary cache staleness.

---

## Summary of Findings

All four cases share a common root cause: **the locally cached model catalog did not include `kimi-k2.5-free`** at runtime, causing `ProviderModelNotFoundError` in the agent's `getModel()` function at `src/provider/provider.ts`. The model is confirmed available on OpenCode — the issue was temporary cache staleness.

| Case | PR | Error Type | Model | Provider | Stack Location |
|------|-----|-----------|-------|----------|----------------|
| 1 | #851 | ProviderModelNotFoundError | kimi-k2.5-free | opencode | provider.ts:1314 |
| 2 | #850 | ProviderModelNotFoundError | kimi-k2.5-free | opencode | provider.ts:1314 |
| 3 | #424 | UnknownError (zero tokens) | unknown | unknown | N/A |
| 4 | #780 | ProviderModelNotFoundError | kimi-k2.5-free | opencode | provider.ts:1433 |

Key observations:
- Cases 1, 2, 4 all fail with `ProviderModelNotFoundError` for model `kimi-k2.5-free` in the `opencode` provider.
- Case 3 is different: the model/provider resolved to "unknown" and returned zero tokens, suggesting the model resolution failed silently before the request was made.
- Case 4 (v1.24.3) includes an improved error message with a `suggestion` field listing available models, compared to cases 1-2 (v1.24.0) which lack this information.
- The agent explicitly does NOT fall back to a default model when an explicit provider is specified: `"Failed to initialize specified model - NOT falling back to default (explicit provider specified)"`.
