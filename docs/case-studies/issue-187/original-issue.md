# Issue #187: Not all data provided about response of `kilo/glm-5-free` model

## Summary
When using the `kilo/glm-5-free` model via the agent CLI, the step-finish event shows incomplete response metadata:
- `"reason": "unknown"` instead of the actual finish reason
- `"cost": 0` with all token counts as `0`

## Reproduction Command
```bash
echo 'hi' | agent --model kilo/glm-5-free
```

## Environment
- Agent version: 0.16.0
- Platform: Linux
- Date: 2026-02-15

## Problematic Output
The `step_finish` event shows:
```json
{
  "type": "step_finish",
  "part": {
    "reason": "unknown",
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    },
    "model": {
      "providerID": "kilo",
      "requestedModelID": "z-ai/glm-5:free",
      "respondedModelID": "z-ai/glm-5"
    }
  }
}
```

## Expected Behavior
The response should include:
- Actual finish reason (e.g., "stop", "end_turn", "length", etc.)
- Actual token usage counts (input, output, reasoning)
- Calculated cost based on model pricing

## Root Cause Investigation
To be determined through analysis of:
1. How the kilo provider extracts response metadata
2. OpenRouter API response format
3. AI SDK provider integration
