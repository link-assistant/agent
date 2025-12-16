---
'@link-assistant/agent': patch
---

fix: Pass API key to providers with multiple env var options

Fixes #61 - Error when using google/gemini-3-pro model. When providers have multiple possible environment variables (like Google with GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY), the code was finding the API key correctly but then not passing it to mergeProvider.
