---
'@link-assistant/agent': patch
---

Fix empty string system message override. When --system-message "" is provided, the system now correctly overrides with an empty string instead of falling back to the default system prompt. This was caused by a falsy check (if (input.system)) that evaluated to false for empty strings. Changed to explicit undefined check (if (input.system !== undefined)) to properly distinguish between undefined (use default) and empty string (override with empty).
