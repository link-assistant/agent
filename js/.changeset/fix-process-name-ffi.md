---
'@link-assistant/agent': patch
---

Fix process name to show as 'agent' instead of 'bun' in top/ps using platform-specific system calls

The previous fix using process.title/process.argv0 did not work in Bun because Bun does not implement the process.title setter. This fix uses Bun's FFI to call prctl(PR_SET_NAME) on Linux and pthread_setname_np on macOS, which correctly sets the kernel-level process name visible in top, ps, and htop.
