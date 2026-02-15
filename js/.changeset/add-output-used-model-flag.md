---
'@link-assistant/agent': minor
---

Add --output-response-model and --summarize-session flags for auxiliary task control

## Changes

### New Flags

1. **`--output-response-model`** (or `AGENT_OUTPUT_RESPONSE_MODEL=true`)
   When enabled, includes model information in `step_finish` parts:

   ```json
   {
     "type": "step_finish",
     "part": {
       "model": {
         "providerID": "opencode",
         "requestedModelID": "big-pickle",
         "respondedModelID": "gpt-4o-mini-2024-07-18"
       }
     }
   }
   ```

2. **`--summarize-session`** (or `AGENT_SUMMARIZE_SESSION=true`)
   Controls AI-powered session summarization. **Disabled by default** to save tokens.
   When enabled, generates summaries using a small/cheap model.

### Token Savings

By default, both `--generate-title` and `--summarize-session` are now disabled,
which means:

- No auxiliary models are loaded when all auxiliary tasks are disabled
- No extra tokens are consumed for title generation or session summarization
- Users can explicitly enable these features when needed

### Renamed Fields

The model info schema now uses clearer field names:

- `modelID` → `requestedModelID` (the model you asked for)
- `responseModelId` → `respondedModelID` (the actual model that responded)

This helps clarify the distinction between what was requested and what actually
processed the request.

Fixes #179
