---
'@link-assistant/agent': patch
---

Fix ProviderModelNotFoundError for newly added models like kimi-k2.5-free

When the models.dev cache was missing or stale, the refresh() call was not awaited,
causing the agent to use outdated/empty cache data. This led to ProviderModelNotFoundError
for models that exist in the remote API but weren't in the local cache.

The fix ensures that:

- When no cache exists (first run): await refresh() before proceeding
- When cache is stale (> 1 hour old): await refresh() to get updated model list
- When cache is fresh: trigger background refresh but use cached data immediately

Fixes #175
