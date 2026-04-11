---
'@link-assistant/agent': patch
---

Lower compaction safety margin from 85% to 75% to reduce context overflow errors. Add token estimation fallback when providers return 0 token counts. Cap maxOutputTokens to never exceed model context limit.
