---
'@link-assistant/agent': patch
---

Fix model resolution failures and ensure JSON-only output (#200)

- Try unlisted models instead of throwing ProviderModelNotFoundError
- Auto-refresh models.dev cache when model not found in catalog
- Intercept stderr to wrap Bun's plain-text errors in JSON envelope
- Add unit tests for model fallback and JSON error wrapping
- Add case study documentation with root cause analysis
