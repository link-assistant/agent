---
'@link-assistant/agent': patch
---

Handle object types for token counts and finishReason

- Enhanced `toNumber()` to extract `total` from objects with that field
- Added `toFinishReason()` to safely convert object/string finishReason values to string
- Updated `processor.ts` to use the new `toFinishReason()` function
- Fixes ZodError crashes on Ubuntu with newer Bun versions (1.3.6+)

Fixes #125
