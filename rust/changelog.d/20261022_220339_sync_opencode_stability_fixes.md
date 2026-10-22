---
bump: patch
---

### Fixed

- `edit` no longer replaces unrelated code through loose block-anchor
  matching, and an empty `oldString` no longer overwrites an existing file
  (synced from upstream OpenCode #30932, #335).
- `edit` keeps CRLF and mixed line endings and the UTF-8 BOM; `write` keeps
  the BOM (upstream #9443, #53166, #23797).
- `edit` no longer reports success without changing a CRLF file when only a
  whitespace-tolerant match was found.
- `edit` and `write` return a short confirmation instead of an empty output.
- `read` caps output at 50 KB and 2000 lines, reports directories, offsets
  past the end and non-regular files, finds file names with narrow no-break
  spaces or curly quotes, and samples only 4 KB for the binary check.
- `grep` searches hidden files and skips `.git`; `glob` stops at 100 results
  and says so.
- `bash` no longer deadlocks on large stderr output, keeps the end of long
  output without splitting UTF-8 characters (which panicked before), keeps
  partial output on timeout and reports the terminating signal.
- `webfetch`, `websearch` and `codesearch` stop reading bodies over 5 MB,
  retry Cloudflare challenges, accept plain JSON or SSE replies from Exa and
  pass `EXA_API_KEY` when set; `webfetch` defaults to markdown.
