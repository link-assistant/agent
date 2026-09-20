---
'@link-assistant/agent': patch
---

fix: accept null Claude OAuth subscription metadata

Claude Code can store `null` for `subscriptionType` and `rateLimitTier` when
that optional account metadata is unavailable. Treat those values as omitted
while continuing to validate the required tokens and expiry, so an unrelated
provider run does not emit a Claude credential error during discovery.

Closes #309
