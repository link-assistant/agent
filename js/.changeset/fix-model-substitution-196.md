---
'@link-assistant/agent': patch
---

fix: validate model argument and detect zero-token provider failures (#196)

- Always prefer CLI model argument over yargs default to prevent silent model substitution
- Throw on invalid provider/model format instead of falling back to defaults
- Warn when explicit model not found in provider's model list
- Detect zero-token responses with unknown finish reason as provider failures
- Add case study documentation for incident analysis
