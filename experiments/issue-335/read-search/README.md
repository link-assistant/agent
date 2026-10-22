# Issue #335: read/grep/glob/ls reliability experiments

Proof scripts for the read and search fixes ported from upstream OpenCode.
Run each with `bun <script>` from this directory. Fixtures go under
`/tmp/issue-335-read-search/`.

- `e1-grep-exit2.ts`: rg exits with code 2 when a path is unreadable, but matches are still printed (#8612)
- `e2-files-early-break.ts`: breaking out of `rg --files` early leaves rg blocked on a full pipe (#10833)
- `e2b-files-early-break-fixed.ts`: the same with `reader.cancel()` + `proc.kill()`
- `e3-stderr-before-stdout.ts`: reading stdout before stderr deadlocks once stderr fills its pipe
- `e4-read-missing-and-dir.ts`: read errors for a missing parent and for a directory
- `e5-read-misc.ts`: CRLF, trailing newline, offset past EOF, U+202F names
- `e6-read-large.ts`: whole-file reads of large files
- `e7-read-output-size.ts`: read output size without a byte cap (about 4 MB) versus the 50 KB cap
- `e8-unsupported-image.ts`: which image types providers accept
- `e9-read-relative-path.ts`: resolving relative paths against the worktree versus the directory
- `bun-spawn-env.ts`: `Bun.spawn` ignores `process.env` changes made at runtime
