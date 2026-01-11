---
'@link-assistant/agent': patch
---

Add publish verification and failure detection to prevent false positives

The npm publish script now detects failures even when changeset publish exits with code 0. This prevents the CI from falsely reporting success when packages fail to publish.
