# Issue #335 experiments: edit / write tools

Scripts that reproduced the edit/write defects before the upstream sync.
Run from the repository root, e.g. `bun experiments/issue-335/edit-write/01-parallel-edits.ts`.
On the fixed code each script reports the corrected behaviour.

- `01-parallel-edits.ts` – concurrent edits of one file lose updates (no per-file lock).
- `02-bom-crlf.ts` – UTF-8 BOM dropped; CRLF files partially converted to LF.
- `03-filetime-future-mtime.ts` – a future mtime or `dir/./file` path makes edit fail after read.
- `04-replaceall-dollar.ts` – `replaceAll` interprets `$&` / `$'` in `newString`.
- `../empty-oldstring-hang.ts` – `replace(content, '', x)` never returns.
