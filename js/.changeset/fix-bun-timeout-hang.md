---
'@link-assistant/agent': patch
---

Fix indefinite hang when using Kilo provider by adding timeout to BunProc.run (#173)

- Add DEFAULT_TIMEOUT_MS (2 minutes) for subprocess commands
- Add INSTALL_TIMEOUT_MS (60 seconds) for package installation
- Create TimeoutError for better error handling and retry logic
- Add retry logic for timeout errors (up to 3 attempts)
- Add helpful error messages for timeout and recovery scenarios

This prevents indefinite hangs caused by known Bun package manager issues:

- HTTP 304 response handling (oven-sh/bun#5831)
- Failed dependency fetch (oven-sh/bun#26341)
- IPv6 configuration issues
