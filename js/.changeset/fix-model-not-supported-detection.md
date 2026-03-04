---
'@link-assistant/agent': patch
---

fix: detect model-not-supported errors from provider response body (#208)

When the OpenCode provider (and similar OpenRouter-compatible proxies) removes
or restricts access to a model, the API returns HTTP 401 with a response body
like `{"type":"error","error":{"type":"ModelError","message":"Model X not
supported"}}`. Without special handling this looks identical to a real
authentication failure, making the root cause hard to diagnose.

The fix adds `SessionProcessor.isModelNotSupportedError()` which parses the
response body and detects the `ModelError` pattern from OpenCode/OpenRouter.
When detected, a dedicated error log entry is emitted that:

- Clearly labels the error as a model-availability issue, NOT an auth error
- Includes the providerID, modelID, and full response body
- Suggests using `--model <provider>/<model-id>` to specify an alternative
- Links to the case study for further investigation

The fix also adds 11 unit tests covering nested/flat JSON formats, real auth
errors (should not be flagged), plain-text fallback detection, and edge cases.

Root cause documented in `docs/case-studies/issue-208/` with the full
1920-line log from the failing run.
