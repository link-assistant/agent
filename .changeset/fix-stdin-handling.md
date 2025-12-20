---
'@link-assistant/agent': minor
---

feat: Improve CLI stdin handling with new options and user feedback

- Add `-p`/`--prompt` flag to send prompts directly without stdin
- Add `--disable-stdin` flag to explicitly disable stdin mode
- Add `--stdin-stream-timeout` for optional timeout on stdin reading
- Add `--dry-run` flag for simulating operations
- Output JSON status message when entering stdin listening mode
- Include CTRL+C exit hint and --help guidance
- Show help immediately when running in interactive terminal (TTY)
- Remove default timeout on stdin reading (wait indefinitely by default)

This improves user experience by:

1. Never hanging silently - always provide feedback
2. Supporting multiple input modes (stdin, direct prompt, help)
3. Following CLI best practices from clig.dev guidelines
