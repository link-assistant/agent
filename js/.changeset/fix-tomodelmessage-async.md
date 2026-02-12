---
'@link-assistant/agent': patch
---

fix: make toModelMessage async for AI SDK 6.0 compatibility

The AI SDK 6.0 changed convertToModelMessages() from synchronous to asynchronous,
which caused "Spread syntax requires ...iterable[Symbol.iterator] to be a function"
errors when spreading the result.

Changes:

- Make MessageV2.toModelMessage async and await convertToModelMessages
- Update all callers in prompt.ts, compaction.ts, summary.ts to await

Fixes #155
