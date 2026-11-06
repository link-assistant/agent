# JS ↔ Rust parity audit (issue #335 branch)

Scope: `js/src` (primary, Bun/TS) vs `rust/src` (tools + CLI only). This is a read-only audit; no source files were changed.

Branch column: **B** means the divergence was introduced or touched by this branch (`git diff origin/main...HEAD`). **U** means it was unchanged by the branch, so it pre-dates it.

Files changed by the branch:
- JS: `ripgrep.ts`, `time.ts`, `bash.ts/.txt`, `codesearch.ts`, `edit.ts`, `glob.ts`, `grep.ts`, `ls.ts`, `read.ts`, `task.ts`, `tool.ts`, `webfetch.ts/.txt`, `websearch.ts/.txt`, `write.ts`, and the new `util/bom.ts`, `util/exa-mcp.ts`, `util/read-bounded.ts`.
- Rust: `bash.rs`, `codesearch.rs`, `edit.rs`, `glob.rs`, `grep.rs`, `read.rs`, `webfetch.rs`, `websearch.rs`, `write.rs`, plus tests.

Files not touched by the branch:
- Rust: `list.rs`, `batch.rs`, `todo.rs`, `invalid.rs`, `multiedit.rs`, `util/*`, `id.rs`, `permission.rs`, `cli.rs`.
- JS: `batch.ts`, `todo.ts`, `invalid.ts`, `registry.ts`, `permission/index.ts`, `id.ts`, `binary.ts`, `filesystem.ts`.

## 0. Cross-cutting

| # | Divergence | JS | Rust | Br |
|---|---|---|---|---|
| X1 | **Raw args vs defaults.** JS validates with zod but passes the raw args to `execute`, so defaults and coercions are not applied. Rust serde applies `#[serde(default)]`, and its typed ints reject strings, negatives and floats that JS normalises (read/bash/webfetch). | `tool/tool.ts` L95-110 | each `*Params` struct | U |
| X2 | **Error wrapper text.** JS validation error: "The X tool was called with invalid arguments: …\nPlease rewrite the input…". Rust uses the `AgentError` Display: "Invalid arguments for tool 'x': …", "Tool execution failed: …", "File not found: p". Rust suggestions appear only in `to_json`. | `tool/tool.ts` L95-110 | `error.rs`, `tool/mod.rs` | U |
| X3 | **Path resolution.** JS calls `path.resolve(Instance.directory, p)`, which normalises `..`, and builds titles with `relative(Instance.worktree, …)`. Rust calls `working_directory.join(p)` with no normalisation, and `relative_path` strips the cwd prefix or returns the absolute path. | per-tool | `tool/context.rs` L63-77 | U |
| X4 | **Registry.** JS registers `task` and does not register `multiedit`; Rust is the reverse. JS also filters `deniedTools` (READ_ONLY_DENIED_TOOLS + config.disableTools); Rust has no equivalent. | `tool/registry.ts` L28-55, L76-93 | `tool/mod.rs` L87-104 | U |
| X5 | **Permissions.** JS tools call `Permission.check`/`ask` (edit, write, bash, webfetch). Rust ports the policy faithfully in `permission.rs`, but **no Rust tool calls it**; only `cli.rs` validates it. | `permission/index.ts` | `permission.rs`; `cli.rs` L243-250, L381 | U |
| X6 | **FileTime.** JS records reads, asserts read-before-edit/write, and serialises edits with a per-file lock. Rust has none of this. | `file/time.ts`; read.ts L246; edit.ts L83, L106; write.ts L30-53 | — | B (JS side touched) |
| X7 | **BOM.** Bun `file.text()` and `Bom.split/join` strip and restore a UTF-8 BOM. Rust `read_to_string` keeps U+FEFF in the content. | `util/bom.ts`; edit.ts L107, L121-126 | read.rs, edit.rs | B |

## 1. Tools

### read (`js/src/tool/read.ts` ↔ `rust/src/tool/read.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Empty file.** JS returns 1 line ("total 1 lines"); Rust returns 0 lines ("total 0 lines"). The line splitters differ: JS uses `/\r?\n/` and pops a trailing `''`, Rust uses `lines()`. | L261-265 | L177 | B |
| **BOM.** JS strips it; Rust shows U+FEFF on line 1. | Bun text() | L~170 | B |
| **Numeric params.** JS accepts offset/limit given as strings, negatives or floats; Rust's `usize` rejects them. | L23-38, L292-298 | params | B |
| **Images.** Rust always validates, with no `supportsImages` check and no `LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL` toggle. Its error text is shorter and it takes the mime type from a fixed table. | L~300-390 | L403-459 | U |
| **canonical_name.** Rust does not apply NFC normalisation. | L271-276 | L346-354 | B |
| **Not found.** Rust does not put the suggestions in the message text. | | | U |
| **Mid-character offset.** `byte_offset_to_char_index` differs when the offset falls inside a multibyte character. | | text_window | B |
| **Relative paths.** Both resolve them (Rust via `ctx.resolve_path`, L115). The README "n/a" entry is **wrong**. | | L115 | — |

### edit (`js/src/tool/edit.ts` ↔ `rust/src/tool/edit.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Missing in Rust.** FileTime.assert (read-before-edit), withLock and Permission.check are all absent. | L69, L83, L106 | — | B(JS) |
| **Missing file.** JS: "File X not found". Rust: `FileNotFound`. | L103 | L126-131 | B |
| **Directory.** JS: "Path is a directory, not a file". Rust returns the raw IO error. | L104-105 | L133 | B |
| **Non-UTF-8 file.** Fails in Rust. | | L133 | U |
| **Line endings.** JS converts oldString/newString to the file's ending. Rust normalises to LF and then restores. The results are equal for pure CRLF; mixed files differ. | L19-34, L112-120 | L142-149, L216-239 | B |
| **BOM.** JS strips and restores it; Rust keeps it inside the content, so a match at file start fails. | L107, L121-126 | — | B |
| **metadata.filediff.** JS before/after keep the original endings; Rust stores LF. JS builds the diff with `createTwoFilesPatch`+`trimDiff` (unified, with `@@`); Rust's `create_diff` has no hunk headers. | L144-154 | L172-181, L242-269 | B |
| **oldString == newString.** JS throws a plain Error; Rust returns `InvalidArguments`. | L59 | L82-87 | U |
| **BlockAnchor.** JS picks the best-scoring candidate. Rust returns `None` when there are several candidates, and scores blank middle lines as 1/n. | L250-387 | L469-530, L543-546 | B |
| **isDisproportionateMatch.** JS applies it to every replacer and throws "Refusing replacement…". Rust applies it only in BlockAnchor and silently filters. | L683-691 | L504 | B |
| **Fuzzy uniqueness.** Rust fuzzy replacers do `replacen(&matched,…,1)` with no uniqueness check, and report "multiple matches" only for a literal match. | L655-713 | L333-343 | B |
| **WhitespaceNormalized / EscapeNormalized.** The algorithms differ; Rust lacks the `\\\n` case. | L389-437 | L427-466 | U |

### multiedit
| Divergence | JS | Rust | Br |
|---|---|---|---|
| Registered in Rust only. With `edits: []`, JS throws a TypeError (`results.at(-1)!`) while Rust returns empty output. | `multiedit.ts` L52 | `multiedit.rs` L111 | U |

### write
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Missing in Rust.** No permission, no lock, no `FileTime.read` after the write. | L30-53 | `write.rs` | B(JS) |
| **write.txt claim.** It says "MUST use the Read tool first", but JS does not enforce this for write. | `write.txt` | — | U |

### bash (`js/src/tool/bash.ts` ↔ `rust/src/tool/bash.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Default timeout.** JS 60 000 ms; Rust 120 000 ms. | L21 | L18 | B |
| **Shell.** JS `selectShell` uses `$SHELL` (excluding fish and nu) and falls back to bash/sh. Rust always runs `bash -c`. | L47-63 | L111 | B |
| **stdin.** JS uses `'ignore'`; Rust inherits stdin, so a command that reads stdin hangs. | L301 | L111-ish | B |
| **Output.** JS interleaves stdout and stderr in arrival order. Rust prints stdout, then `"\n--- stderr ---\n"`, then stderr. | L236-260 | L253-268 | B |
| **Title.** JS uses the command; Rust uses the description or the first 3 words. | L377 | L98-106 | U |
| **Metadata.** JS: `{output, exit, signal, timedOut, aborted, description}`. Rust: `{exitCode, exit, signal, output, command, [timedOut]}`. | L370-390 | L160-175 | B |
| **Timeout text.** JS: "(Command timed out after N ms)" plus "Exit code unavailable (signal SIGTERM)". Rust: "Command timed out after Nms". | `process-result.ts` | L147-157 | B |
| **Kill and abort.** JS kills the process tree with SIGTERM→SIGKILL and supports abort. Rust sends SIGKILL to the child only and has no abort. | | | B |
| **Validation.** JS rejects a negative timeout; Rust's `u64` rejects floats and strings. | L174-178 | params | B |
| **Permissions.** JS runs a tree-sitter permission scan of the command; Rust has none. | L187-229 | — | U |
| **Description.** Rust still says "persistent shell session". | | description | U |

### glob (`js/src/tool/glob.ts` + `file/ripgrep.ts` ↔ `rust/src/tool/glob.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Engine and pattern semantics.** JS runs `rg --files --hidden --no-config --glob=!.git/* --glob=<pattern>`, where `*.ts` matches at **any depth** and braces `{a,b}` work. Rust uses the `glob` crate on `base.join(pattern)`, where `*.ts` matches the **top level only** and braces are unsupported. | ripgrep.ts L220-240 | L69-107 | U |
| **.gitignore.** JS respects it; Rust ignores it. | ripgrep | L69-107 | U |
| **Symlinks.** JS (rg without `--follow`) does not follow them; Rust (glob crate metadata) does. | | | U |
| **.git.** JS excludes it; Rust does not, so `**/*` lists `.git/**`. | | | U |
| **Output paths.** JS prints absolute paths; Rust prints `ctx.relative_path`. | L52 | L120 | U |
| **No results.** JS prints "No files found"; Rust prints `""`. | L50 | L~115 | U |
| **Truncation.** JS truncates the first 100 rg results and then sorts by mtime. Rust sorts everything and then keeps the top 100. | L35-48 | L~95-110 | B (Rust LIMIT added) |
| **Title.** JS: `relative(worktree, search)`. Rust: the pattern. | L62 | L84 | U |
| **Missing or non-directory path.** JS errors with "No such file or directory: 'X'" or "Search path is not a directory". Rust returns an empty result. | ripgrep.ts | — | B(JS) |

### grep (`js/src/tool/grep.ts` ↔ `rust/src/tool/grep.rs`) — the largest divergence
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Schema.** JS takes `{pattern, path, include}`. Rust takes `{pattern, path, glob, output_mode="files_with_matches", -i, -n, -B, -A, -C, head_limit}`. Rust silently ignores the JS `include`, and its default mode lists **files only** where JS lists matching lines. | L17-35 | L33-63 | U |
| **Engine.** JS runs `rg`. Rust uses its own WalkDir + `regex` crate (it does **not** shell out to rg), and the regex syntax differs (no look-around). | | L200-240 | U |
| **Walk.** Rust uses `follow_links(true)`, has no .gitignore support and skips only `.git`. JS (rg) does not follow symlinks and respects .gitignore. | | L211, L215-220 | B (hidden→.git) |
| **include/glob filter.** Rust `matches_glob` supports only `*.ext`, `**/*.ext` or an exact name, with no braces. JS passes rg globs. | | L244-253 | U |
| **Output.** JS: "Found N matches\n/abs:\n  Line N: …", grouped by file, mtime-sorted, limit 100, with a truncation note and "No files found". Rust: `relpath:N: line`, with no header, no sort, no 100 limit and `""` when empty. | L60-140 | L260-330 | U |
| **Metadata.** JS `{matches, truncated}`; Rust `{count}`. | | | U |
| **Errors.** Bad regex: JS "Invalid regex pattern: …", Rust "Invalid regex: …". Missing path: JS "Search path does not exist: X", Rust returns empty. Rust has no 30 s timeout, no rg exit-2 "(Some paths were inaccessible and skipped)" and no abort. | | | B(JS) |
| **Non-UTF-8 files.** Rust silently skips them. | | `read_to_string` | U |

### list / ls (`js/src/tool/ls.ts` ↔ `rust/src/tool/list.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Default ignores.** JS has 24 entries (`vendor/` appears twice), applied as rg globs `!p*` so they act as prefixes (e.g. `zig-out*`, `.coverage*`). It also respects .gitignore. Rust matches exact names via `should_ignore` (which has a dead branch) and has no .gitignore support. | L8-33 | L17-41, L193-208 | U |
| **User `ignore`.** JS treats it as globs; Rust only as exact names. | L~60 | L193-208 | U |
| **Truncation note.** Only Rust appends "(Results are truncated…)". | L119 | L248-252 | U |
| **Errors.** Missing path: Rust `FileNotFound`, JS "No such file or directory: 'X'". Not a directory: Rust "Not a directory: X", JS "Search path is not a directory: X". | ripgrep.ts | L111-123 | B(JS) |
| **Ordering.** rg order vs walkdir order. | | | U |
| **Title.** Rust uses the relative path or "."; JS uses `relative(worktree)`. | | L173-177 | U |

### webfetch (`js/src/tool/webfetch.ts` ↔ `rust/src/tool/webfetch.rs`)
The two sides match on: the 5 MB limit, the 30 s default / 120 s max timeout, the `markdown` default, the Cloudflare `cf-mitigated` retry with UA `agent`, and the title.

| Divergence | JS | Rust | Br |
|---|---|---|---|
| **BUG: text extraction.** Rust `extract_text_from_html` compares the whole tag buffer, so `<script type=…>` and `<style media=…>` are **not skipped**. Rust also collapses all whitespace, while JS HTMLRewriter keeps it and only trims. | L183-208 | L245-305 | B |
| **Markdown.** JS uses Turndown; Rust uses a hand-rolled converter that drops lists, tables and blank lines. | L210-220 | L308-335 | U |
| **Possible panic.** Rust `remove_tag_with_content` uses lowercased indices to slice the original string, which can fall mid-character on non-ASCII input. | | L~320 | U |
| **Accept header.** Rust's html Accept lacks `text/markdown;q=0.7`. | L60-75 | L157 | B |
| **Status text.** JS "Request failed with status code: 404"; Rust "…: 404 Not Found". | L~95 | L196-199 | B |
| **Timeout text.** JS "Request timed out after N seconds"; Rust "Request timed out". | L124 | L~205 | B |
| **Invalid URL and permissions.** Rust returns `InvalidArguments` for a bad URL and runs no `Permission.check`. | L46-53 | L139-144 | U |
| **Decoding.** Rust uses lossy UTF-8 decoding and reads Content-Length and content-type before the body. | | | B |

### websearch / codesearch
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **websearch `numResults: 0`.** JS uses `\|\|` and sends 8; Rust sends 0. | `websearch.ts` ~L60 | `websearch.rs` ~L110 | B |
| **websearch enums.** Rust does not validate the `livecrawl`/`type` enums. | | | U |
| **websearch status text.** JS "429"; Rust "429 Too Many Requests". | `exa-mcp.ts` | | B |
| **websearch malformed SSE `data:`.** JS throws a SyntaxError; Rust skips the line. | `exa-mcp.ts` | | B |
| **websearch description.** Rust's text differs from `websearch.txt`, and Rust caches the year in a OnceLock. | | | B |
| **codesearch `tokensNum` outside [1000, 50000].** JS fails zod validation; Rust clamps. | L30-34 | L99-102 | U |
| **codesearch description.** Rust's text differs. | | | U |

### batch (`js/src/tool/batch.ts` ↔ `rust/src/tool/batch.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **BUG: dropped calls.** Rust does `.take(MAX_BATCH_CALLS + 1)`, so only the 11th call is reported as discarded. Calls 12 and later **vanish silently**, and totalCalls, tools and details are wrong. JS reports every discarded call. | L39-40, L145-166 | L118-128 | U |
| **Execution order.** Rust runs calls sequentially; JS runs them in parallel (`Promise.all`). | L~120 | L139-190 | U |
| **Missing in Rust.** No deniedTools check, no attachments aggregation, no part updates. | L59-63, L180-182 | — | U |
| **Empty array.** JS uses `formatValidationError` ("Invalid parameters for tool 'batch': … Expected payload format …"); Rust returns `InvalidArguments`. | | | U |
| **Error prefix.** Per-call error text carries "Tool execution failed:" in Rust. | | | U |
| **multiedit.** Rust can call it. | | | U |

### todowrite / todoread (`js/src/tool/todo.ts` + `session/todo.ts` ↔ `rust/src/tool/todo.rs`)
| Divergence | JS | Rust | Br |
|---|---|---|---|
| **Incompatible schema.** JS: `{content, status (pending\|in_progress\|completed\|cancelled), priority, id}`. Rust: `{content, status enum without cancelled, activeForm (required)}`. A JS-shaped call **fails** in Rust. | `session/todo.ts` L6-19 | L19-39 | U |
| **Storage.** JS uses Storage + Bus; Rust keeps the list in memory. | | | U |
| **Description.** Rust's is one line; JS uses `todowrite.txt`. | | | U |

### invalid
Equivalent apart from the error wrapper (X2).

## 2. Re-check of the README §4–§5 "n/a" Rust entries
- **grep.** Rust uses its own WalkDir + regex walker, not rg. The rg-specific fixes (exit 2, pipe, timeout, `--no-config`) genuinely are n/a. However, the walker **follows symlinks** (`grep.rs` L211) and **ignores .gitignore**; record these as divergences, not n/a.
- **read relative paths.** **Not n/a.** Rust resolves them via `ctx.resolve_path` (`read.rs` L115). Rust's lack of `..` normalisation differs from `path.resolve`.
- **glob symlinks.** Rust (`glob` crate) **follows** symlinks; JS rg does not. Not n/a. Rust list uses `follow_links(false)`, which matches JS.
- **FileTime read-before-edit.** Rust has **no** FileTime, so it has no read-before-edit check, no lock and no read stamps. This is a real behavioural divergence, not n/a.
- **"bash already bash".** Outdated: JS now picks `$SHELL`.
- **HTML script/style skipping.** Rust only handles bare tags; tags with attributes leak their content.
- **"replaceAll literal".** Correct.

## 3. CLI and JSON I/O (`js/src/index.js`, `js/src/cli/**`, `js/src/config/config.ts` ↔ `rust/src/cli.rs`)
- **Options only in JS.**
  - `--read-only` and `--disable-tools` (`cli/run-options.js` L216-226).
  - Subcommands `mcp`, `auth`, `models`, `agent`, `export`, `stats` (index.js L655-661, `cli/cmd/*`).
  - The middleware mapping `--output-format` to `json-standard` (run-options.js L144-159).
- **Options only in Rust.** `--working-directory`.
- **Accepted but no-op in Rust.** `--json-standard claude`, `--input-format`, and `InputMessage.tools`.
- **Execution.** The Rust CLI **never executes tools or calls a model**. `run_with_input` prints "Agent (Rust) ready…" text and finishes with `step_finish{reason:"stop"}`.
- **Env vars read by JS only** (`config/config.ts`, plus `.lenv` via lino-arguments): every `LINK_ASSISTANT_AGENT_*` variable for
  - VERBOSE, DRY_RUN, GENERATE_TITLE, OUTPUT_RESPONSE_MODEL, SUMMARIZE_SESSION, COMPACT_JSON
  - CONFIG, CONFIG_DIR, CONFIG_CONTENT
  - DISABLE_AUTOUPDATE, DISABLE_PRUNE, ENABLE_EXPERIMENTAL_MODELS, DISABLE_AUTOCOMPACT, EXPERIMENTAL, EXPERIMENTAL_WATCHER
  - RETRY_TIMEOUT, MAX_RETRY_DELAY, MIN_RETRY_INTERVAL, STREAM_CHUNK/STEP_TIMEOUT_MS, MCP_DEFAULT/MAX_TOOL_CALL_TIMEOUT
  - VERIFY_IMAGES_AT_READ_TOOL, **READ_ONLY**, **DISABLE_TOOLS**
- **Env vars read by Rust.** Only DEFAULT_MODEL, DEFAULT_COMPACTION_MODEL(S), DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT (`defaults.rs`), and PERMISSION_MODE / PERMISSION (`permission.rs` L35-65).
- **Events emitted by JS.** status, step_start, text, tool_use, tool_result, step_finish, error, input, init, config, idle, session_idle, log, message, permission_request, result, warning.
  - Envelopes carry `{type, timestamp, sessionID, part}` (`cli/event-handler.js` L57-145). Resume `status` events add mode, sessionID, title and forked (`continuous-mode.js` L200-230).
- **Events emitted by Rust** (`OutputEvent`, cli.rs L271-315):
  - status, step_start, text, step_finish, error, plus tool_use, which is defined but never emitted.
  - `error` is `{timestamp, sessionID:null, error{name,data}}`, and step parts are synthetic.

## 4. Utilities
- **binary.** These are unrelated modules that share a name.
  - JS `util/binary.ts` provides `Binary.search/insert` over sorted arrays, which has no Rust counterpart.
  - Rust `util/binary.rs` holds binary/image detection, ported from read.ts `isBinaryFile` (L481-542), `isImageFile` (L365-390) and `validateImageFormat` (L401-452). The port is equivalent.
- **filesystem.**
  - **BUG:** Rust `contains` (`util/filesystem.rs` L52-65) canonicalises, which follows symlinks. When a path does not exist it falls back to a **string prefix**, so `contains("/a/b","/a/bc")` returns true. JS `util/filesystem.ts` uses a lexical `relative()`, which returns false.
  - Rust `overlaps` is component-based; JS uses string `startsWith('..')`.
  - Rust lacks `up`/`globUp` (JS L29-72).
  - The Rust `Filesystem` module is unused.
- **id.**
  - Same format and algorithm, and Rust adds `Prefix::Call`.
  - Rust panics where JS throws; for example, given `""` JS generates a new id while Rust panics.
  - Rust's counter does a non-atomic load-then-store.
  - JS `randomBase62` is modulo-biased (`byte%62`); Rust is uniform.
  - Rust has no zod `schema()`.
- **permission.**
  - Ported faithfully: modePolicy, readonlyBash (identical list), parseOverride, policy, wildcard, allStructured, evaluateBash.
  - Differences: Rust `parse_action_value` rejects non-strings with different text, and Rust has no ask/respond/RejectedError/checkBashTokens.
  - **Latent panic:** Rust `split_segments` slices `&command[i..i+2]` on byte indices (`permission.rs` L514), which panics on non-ASCII input such as `echo é && ls`.
  - **Not wired:** no Rust tool consults the policy (X5).

## 5. JS subsystems with no Rust counterpart
- **agent**: agent definitions and system prompts.
- **auth**: provider credentials and OAuth.
- **bus**: event bus for session, part and permission events.
- **command**: slash or user commands.
- **file/time**: FileTime read stamps, read-before-edit assert and the per-file lock.
- **file/ripgrep**: rg discovery, download and files/search wrapper.
- **format**: post-edit formatters.
- **mcp**: MCP client and tool timeouts.
- **patch**: patch application.
- **project/instance**: worktree and directory context.
- **provider**: model providers, message sanitising and transforms.
- **server**: HTTP server and API.
- **session**: prompt loop, compaction, retry, summary, todo storage and processors.
- **snapshot**: git snapshots and revert.
- **storage**: persistent JSON storage.
- **task tool**: sub-agent tool, absent from the Rust registry.
- **json-standard claude output**: the Claude-compatible stream format.
- **cli/cmd subcommands**: mcp, auth, models, agent, export, stats.
- **continuous-mode / input queue**: stdin streaming and session resume/fork.
- **verbose-fetch**: HTTP logging.
- **config via lino-arguments / .lenv**: `LINK_ASSISTANT_AGENT_*` env handling.
- **util/bom**: BOM split/join.
- **util/read-bounded**: bounded body reading (Rust uses inline equivalents).
- **util/wildcard**: Rust has it only inside `permission.rs`.
- **Binary.search/insert**: sorted-array helpers.
- **Read-only / disable-tools tool filtering**: removes denied tools before a run.

## 6. Prioritised fix list
1. **grep.** Accept JS `include` (alias to `glob`), default to content output in the JS format ("Found N matches", grouped by file, mtime sort, 100 limit, "No files found"), and set metadata `{matches,truncated}`. Either use rg or the `ignore` crate (.gitignore, no symlink following), and error on a missing path. `grep.rs` L33-63, L200-330 ↔ `grep.ts` L17-140.
2. **glob.** Use the `ignore`/`globset` crates with rg semantics (a slash-less pattern matches at any depth, braces, .gitignore, exclude `.git`, no follow). Print absolute paths and "No files found", and take the first 100 before sorting. `glob.rs` L69-120 ↔ `glob.ts` L35-62, `ripgrep.ts` L220-240.
3. **todo.** Align the schema: add `cancelled`, `priority` and `id`; make `activeForm` optional or drop it; use the description from `todowrite.txt`. `todo.rs` L19-39 ↔ `session/todo.ts` L6-19.
4. **batch.** Collect every call and then `split_off(MAX)`. `batch.rs` L118-128 ↔ `batch.ts` L39-40, L145-166. Consider parallel execution.
5. **Permissions and FileTime in Rust tools.** Call `permission.rs` from edit, write, bash and webfetch, and add a FileTime equivalent (read stamp, assert before edit, lock), or document the gap. `edit.rs`, `write.rs` ↔ `edit.ts` L69-106, `write.ts` L30-53.
6. **bash.**
   - Set the default timeout to 60 000 ms.
   - Set stdin to null.
   - Use the `$SHELL` selection (excluding fish and nu).
   - Interleave stdout and stderr.
   - Use metadata keys `{output, exit, signal, timedOut, aborted, description}` and the JS timeout text.
   - Kill the process tree.

   `bash.rs` L18, L98-175, L253-268 ↔ `bash.ts` L21, L47-63, L236-301, L370-390.
7. **read.** Make an empty file count as 1 line, use JS line splitting (`/\r?\n/`, pop the trailing empty line), strip the BOM, apply NFC in canonical_name, and accept numeric strings. `read.rs` L115-177, L346-354 ↔ `read.ts` L23-38, L261-276.
8. **edit.**
   - Use the "File X not found" and "Path is a directory" messages.
   - Add BOM split/join.
   - Keep the original endings in filediff.
   - Produce a unified diff with `@@` headers.
   - BlockAnchor should pick the best candidate.
   - Apply the disproportionate-match check to all replacers and throw on it.
   - Check uniqueness for fuzzy matches.

   `edit.rs` L82-546 ↔ `edit.ts` L19-154, L250-713.
9. **list.** Use glob-based prefix ignores, respect .gitignore, treat user ignore entries as globs, drop the extra truncation note, and use the JS error texts. `list.rs` L17-41, L111-123, L193-252 ↔ `ls.ts` L8-33, L119.
10. **webfetch.** Fix script/style skipping when the tag has attributes. Port Turndown-like markdown or use `html2md`. Use the JS status text ("404") and timeout text, and add `text/markdown;q=0.7`. Make the tag removal safe for non-ASCII. `webfetch.rs` L157, L196-335 ↔ `webfetch.ts` L60-220.
11. **CLI.** Add `--read-only`, `--disable-tools` and the `LINK_ASSISTANT_AGENT_READ_ONLY/DISABLE_TOOLS` env vars (a registry filter); add the `timestamp/sessionID/part` envelope; or document that the Rust CLI is a non-executing stub. `cli.rs` L243-470 ↔ `run-options.js` L144-226, `event-handler.js` L57-145.
12. **Latent panics and bugs.** Fix the `split_segments` byte-index slicing (`permission.rs` L514) and the `Filesystem::contains` string-prefix fallback (`util/filesystem.rs` L59-64) vs `filesystem.ts` `contains`. The id panic on `""` should fall back to generating a new id.
13. **Minor.**
    - websearch: `numResults` 0 should become 8; validate the enums; use the JS status text; port the description.
    - codesearch: validate `tokensNum` rather than clamping.
    - multiedit: handle `edits: []` in JS.
14. **Docs.** `rust/README.md` claims 7 tools, but all of them exist. Correct the "n/a" rows in `docs/case-studies/issue-335/README.md` §4-§5 as described in §2.
