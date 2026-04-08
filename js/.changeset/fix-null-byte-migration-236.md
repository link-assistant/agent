---
'@link-assistant/agent': patch
---

fix: prevent null byte in storage migration file path (#236)

- Replace `fs.exists()` (non-standard, called without `await`) with properly awaited `fs.stat().isDirectory()` checks
- Read migration version file with `.text()` instead of `.json()` to match how it's written
- Add unit tests confirming the Bun null-byte-in-ENOENT behavior and verifying the fix
