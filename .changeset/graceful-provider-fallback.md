---
'@link-assistant/agent': patch
---

fix: Add retry logic and serialized installation for reliable provider initialization

Fixes issue #72 where version 0.3.0 appeared "completely broken" due to race conditions in parallel package installations causing Bun cache corruption.

Root Cause:

- When multiple provider packages (e.g., @ai-sdk/openai-compatible, @ai-sdk/openai) are installed concurrently, they can cause race conditions in Bun's package cache
- This leads to "FileNotFound: failed copying files from cache" errors on first run after update

Changes:

- Add write lock to serialize package installations (prevents concurrent bun add commands)
- Add retry logic with up to 3 attempts for cache-related errors
- Improve error detection to catch ENOENT, EACCES, EBUSY errors
- Add delay between retries to allow filesystem operations to complete

Impact:

- opencode/grok-code remains the default provider and works reliably
- Agent handles transient cache issues gracefully with automatic retries
- Better stability during first run after installation/update
