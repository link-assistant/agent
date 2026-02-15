---
'@link-assistant/agent': minor
---

Add --output-used-model flag to include model information in output

When enabled via CLI flag (`--output-used-model`) or environment variable
(`AGENT_OUTPUT_USED_MODEL=true`), the agent now includes model information
in `step_finish` parts:

```json
{
  "type": "step_finish",
  "part": {
    "model": {
      "providerID": "opencode",
      "modelID": "big-pickle",
      "responseModelId": "gpt-4o-mini-2024-07-18"
    }
  }
}
```

This helps users understand which model actually generated each response,
especially when auxiliary models are used for background tasks like title
generation.

Also added clearer log messages for `getSmallModel()` to explain that
selected models are for auxiliary tasks (title/summary generation),
not primary user requests.

Fixes #179
