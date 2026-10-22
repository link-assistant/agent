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
