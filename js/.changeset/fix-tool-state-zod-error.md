---
'@link-assistant/agent': patch
---

Fix ZodError in session processor when tool execution fails

- Change tool error status from 'failed' to 'error' in processor.ts to match ToolStateError Zod schema
- Fix cleanup loop to use 'error' status consistently with the discriminated union definition
- Update event-handler.js to check for 'error' status instead of 'failed'
- Add case study analysis for issue #149 documenting root cause and fix
