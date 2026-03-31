---
'@link-assistant/agent': patch
---

fix: prevent rate-limit amplification for free-tier models by using different model for summarization and capping retry-after at MAX_RETRY_DELAY (#223)
