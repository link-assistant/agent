---
'@link-assistant/agent': patch
---

fix: sync reliability fixes for existing tools from upstream OpenCode (#335)

- `edit` and `write` serialize changes to the same file, so parallel edits no
  longer overwrite each other (upstream #4388, #23483).
- `edit` no longer replaces unrelated code through loose fuzzy matching, and
  an empty `oldString` no longer overwrites an existing file (upstream #30932).
- `edit` keeps CRLF, mixed line endings and a UTF-8 BOM; `write` keeps the
  BOM (upstream #9443, #53166, #23797).
- `replaceAll` inserts `$&`, `$1` and similar text literally.
- The "modified since read" check compares file mtime and size instead of
  clocks, and treats equivalent paths as one file (upstream #17835, #20367).
- `edit` works right after `write`, and both return a short confirmation.
