# Rust tool parity fixes (issue #335)

Follow-up to `js-rust-parity-audit.md` (§6 fix list) and
`backward-compat-audit.md`. JS is the reference. Every behaviour change
has a test; where it changes what an earlier Rust release did, a switch
restores the earlier behaviour and a legacy test covers it. Tests that need
a switch use `ToolContext::with_settings`, so no test mutates the process
environment.

## Switches (`rust/src/compat.rs`, flags in `rust/src/cli.rs`)

| Variable | Flag | Restores / sets |
| --- | --- | --- |
| `LINK_ASSISTANT_AGENT_BASH_SHELL` | `--bash-shell` | `legacy` = `bash -c` |
| `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT` | `--legacy-tool-output` | earlier output text, errors, diff format, truncation |
| `LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING` | `--legacy-edit-matching` | earlier edit matching (empty oldString overwrite, unguarded block anchor, no BOM handling, no disproportionate refusal) |
| `LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS` | `--glob-follow-symlinks` | follow symlinks in glob/grep/list |
| `LINK_ASSISTANT_AGENT_GREP_HIDDEN` | `--grep-hidden` | `false` = skip dotfiles |
| `LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS` | `--grep-timeout-ms` | grep time limit |
| `LINK_ASSISTANT_AGENT_READ_MAX_LINES` / `_READ_MAX_BYTES` | `--read-max-lines` / `--read-max-bytes` | read caps, 0 = none |
| `LINK_ASSISTANT_AGENT_READ_ONLY` | `--read-only` | JS read-only tool filter |
| `LINK_ASSISTANT_AGENT_DISABLE_TOOLS` | `--disable-tools` | JS disableTools filter |

The audit proposed separate `EDIT_ALLOW_EMPTY_OLDSTRING`,
`EDIT_FUZZY_THRESHOLD`, `GLOB_LIMIT` switches; they are folded into
`LEGACY_EDIT_MATCHING` and `LEGACY_TOOL_OUTPUT`.

## Done (audit §6 numbering)

1. grep: JS listing, `include` alias, rg-style walk (`.gitignore`/`.ignore`,
   no symlinks, `.git` skipped, binary skipped), time limit, errors.
2. glob: `rg --files` semantics, absolute paths newest first, 100 limit,
   "No files found", errors.
3. todo: JS schema (`cancelled`, `priority`, `id`, optional `activeForm`).
4. batch: every call past 10 is reported (calls still run sequentially).
5. Permissions / FileTime: not done, see gaps.
6. bash: `$SHELL` selection with a POSIX allowlist, stdin `/dev/null`,
   process-group kill, metadata `timedOut`/`aborted`/`description`.
7. read: JS line splitting, empty file = 1 line, BOM, NFC names, numeric
   string params, streaming, caps.
8. edit: new `rust/src/tool/edit_match.rs` ports the JS replacers in the JS
   order (best-scoring block anchor at 0.65, disproportionate refusal with
   the JS error, unique candidate or next replacer, JS `trim`/`\s`
   whitespace, UTF-16 lengths for the similarity, `\\\n` unescape), BOM
   split/join, jsdiff `createTwoFilesPatch` + `trimDiff` diff (4 lines of
   context, as the jsdiff default), `filediff` with the file's own line
   endings, JS errors for missing file, directory and empty `filePath`.
   Reference outputs were generated with the JS code and the `diff`
   package and are asserted in `rust/tests/tool_edit.rs`.
9. list: JS ignore globs, `.gitignore`/`.ignore`, no truncation note,
   JS errors and title.
10. webfetch: script/style with attributes, JS status/timeout text,
    `text/markdown;q=0.7`, non-ASCII-safe tag removal.
11. CLI: `--read-only`, `--disable-tools` and the env vars (registry
    filter, batch rejects them).
12. Latent bugs: `permission.rs` non-ASCII panic, `Filesystem::contains`
    prefix fallback, id panic on `""`.
13. websearch: `numResults: 0` = 8, enum validation.
14. Docs: `rust/README.md` tool list and switch table; changelog fragment
    `rust/changelog.d/20261103_002356_tool_js_parity_and_compat_switches.md`.

write needed no change: BOM handling, metadata and "Wrote file
successfully." already match JS.

## Deliberate divergences

- edit: the replacers run on the LF view of the file and the result is
  mapped back with `restore_line_endings`; JS converts oldString/newString
  to the dominant ending. Equal for pure LF/CRLF files; Rust also keeps
  the untouched lines of a mixed file.
- edit: an empty candidate (e.g. a whitespace-only oldString after
  trimming) is skipped. JS would accept `""` and `String.replace` would
  insert newString at the start of the file.
- edit/write descriptions keep the Rust text, because the JS `edit.txt`
  and `write.txt` require a prior read that Rust does not enforce.
- bash: default timeout 2 min (JS 1 min) and stdout/stderr joined with
  `--- stderr ---` (JS interleaves); `aborted` is always `false` (no
  abort signal reaches a tool in the CLI).
- codesearch: `tokensNum` is clamped to 1000..=50000 instead of rejected.
- webfetch: markdown conversion is a small converter, not Turndown;
  output differs in details.
- glob/list skip `.git` at any depth; JS passes `--glob=!.git/*` to rg
  (grep already uses `!**/.git/**` in JS, so grep matches).
- grep: the binary check scans the whole file for NUL while streaming
  (rg looks at a prefix and then per buffer).
- legacy glob output keeps the 100 result limit.

## Remaining gaps (not faked)

- FileTime (read-before-edit assert, read stamps) and the per-file edit
  lock (audit X6, §6 item 5) are not implemented. The Rust CLI has no
  session: each invocation is a separate process, and `batch` runs its
  calls one after another, so a lock would never be contended and a
  read stamp could not survive between invocations. Documented in
  `rust/src/tool/edit.rs` and `rust/README.md`.
- Permissions (audit X5): `permission.rs` is still not consulted by the
  tools; the CLI never executes tools from a model, so there is no
  ask/approve loop to hook into.
- Cross-cutting X1-X3: serde defaults vs raw JS args, the `AgentError`
  wrapper text and `join` without `..` normalisation remain, except
  where a tool now coerces numeric strings (read) or uses the JS message.
- edit: a non-UTF-8 file still fails to read.
- multiedit: `edits: []` returns empty output (JS throws a TypeError).
- The Rust CLI does not call an LLM and does not emit the JS event
  envelope (audit §3).
