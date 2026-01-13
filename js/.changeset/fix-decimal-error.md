---
'@link-assistant/agent': patch
---

Fix DecimalError crash in getUsage() when token data contains objects

- Add safe() wrapper function to sanitize numeric inputs before Decimal.js
- Wrap all token calculations with safe() to handle NaN, Infinity, and objects
- Add try-catch around cost calculation as additional safety measure
- Add comprehensive unit tests for edge cases

Fixes #119
