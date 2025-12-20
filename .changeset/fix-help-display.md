---
'@link-assistant/agent': patch
---

fix: show help when no arguments provided instead of hanging

When running 'agent' without arguments, the CLI now displays help text instead of hanging while waiting for stdin input. This fix implements TTY detection and timeout-based stdin reading to provide a better user experience.
