---
'@link-assistant/agent': patch
---

feat: Add echo and cache synthetic providers for robust dry-run mode

Implements `link-assistant/echo` provider that echoes back user input, and
`link-assistant/cache` provider with Links Notation format for caching API
responses. Echo provider is automatically enabled in --dry-run mode for
zero-cost testing of round-trips and multi-turn conversations.

Closes #89
