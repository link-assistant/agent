# Case study: issue #335 — sync stability fixes from upstream OpenCode

Issue: https://github.com/link-assistant/agent/issues/335
Pull request: https://github.com/link-assistant/agent/pull/339

## 1. The issue

> We also need to include all code that increases reliability of our code from
> https://github.com/anomalyco/opencode, so we use all the best practices from
> there, but with no support for additional tools, only fixing existing tools
> if we have potential issues.

The issue was opened on 2026-10-22 by konard. It had no comments when this work
was done.

### 1.1 Requirements

| #   | Requirement (from the issue text)                                              | Where it is handled                            |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| R1  | Include upstream code that increases the reliability of our code               | §4–§6, commits in PR #339                      |
| R2  | Use upstream best practices                                                    | §3 (method), §7 (practices adopted)            |
| R3  | Do **not** add support for additional tools                                    | §2.3 — no tool was registered or added         |
| R4  | Only fix existing tools where we have potential issues                         | §4–§5: every port is a fix to an existing tool |
| R5  | Collect the data related to the issue into `./docs/case-studies/issue-335`     | `data/`, `analysis/`                           |
| R6  | Do a deep case study analysis, including online research for additional facts  | this file, `analysis/*.md`, §8                 |
| R7  | List each and all requirements from the issue                                  | this table                                     |
| R8  | Propose possible solutions and a solution plan for each requirement            | §4–§6 (per-defect solution + status)           |
| R9  | Check known existing components/libraries that solve or help solve the problem | §9                                             |
| R10 | Plan and execute everything in this single pull request                        | PR #339                                        |

## 2. Context and timeline

### 2.1 Where the fork comes from

| Date       | Event                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 2025-11-19 | Fork base: upstream commit `0068cb305f`. Our `js/` tree is a copy of `packages/opencode` from that time. |
| 2025-12-15 | Upstream #4388 adds a per-file lock to `edit` (read-before-write race).                                  |
| 2026-03-07 | Upstream #9443 preserves CRLF line endings in `edit`.                                                    |
| 2026-03-16 | Upstream #17835 replaces the wall-clock read time with an `{mtime, size}` stamp.                         |
| 2026-04-01 | Upstream #20367 normalizes paths used as FileTime keys.                                                  |
| 2026-04-16 | Upstream #22999 deletes the FileTime module (moved into the Effect-based tool runtime).                  |
| 2026-04-20 | Upstream #23483 re-adds per-file edit locking after the Effect refactor.                                 |
| 2026-04-22 | Upstream #23797 preserves the UTF-8 BOM in text tool round-trips.                                        |
| 2026-06-05 | Upstream #30932 stops destructive fuzzy edit matches.                                                    |
| 2026-07-20 | Upstream `44b6938b2a` deletes `packages/opencode`; the code now lives in `packages/core`.                |
| 2026-10-12 | Upstream #53166 preserves mixed line endings in `edit`.                                                  |
| 2026-10-22 | Upstream HEAD `d93568f334` (last tag `github-v1.2.27`). Issue #335 opened.                               |

Because upstream reorganised the code base twice (Effect services, then the
move from `packages/opencode` to `packages/core`), no upstream commit can be
cherry-picked. Every fix was re-implemented on our code, with a test that
fails before the change.

### 2.2 Our two implementations

- `js/` (Bun, TypeScript) — the primary implementation, close to the upstream
  code from 2025-11.
- `rust/` — a port of the same tools. Where a defect also exists there, it is
  fixed there too.

### 2.3 Scope decisions

- **No new tools (R3).** Upstream added tools after the fork point that we do
  not have (`apply_patch`, `lsp`, `question`, `skill`, `plan-enter`,
  `plan-exit`, `code-mode`). None were added. The JS
  `patch` and `multiedit` tools exist in the tree but stay unregistered, as
  before.
- **Write keeps "no restrictions".** Upstream `write` requires a prior read.
  The fork deliberately removed that requirement (commit `db682c8`), so it was
  not re-added. Write now _records_ a read, so an `edit` right after a `write`
  works, and it takes the same per-file lock as `edit`.
- **Session/provider/MCP fixes** are applied only where they fix behaviour of
  code we already have (see §6).

## 3. Method

1. Cloned upstream and listed every commit after the fork base whose subject
   starts with `fix` and that touches tools, session, provider or MCP code:
   900 commits in total (`data/upstream-fix-commits-*.txt`):

   | Area     | Fix commits |
   | -------- | ----------- |
   | tools    | 217         |
   | session  | 399         |
   | provider | 206         |
   | mcp      | 78          |

2. Triaged each commit as **PORT** (the defect exists in our code),
   **ALREADY-HAVE** (we already behave correctly) or **N/A** (the code or
   feature does not exist here, or it is a UI/infra change). The triage
   reports are in `analysis/`.
3. For each PORT item: reproduce with a test or an experiment
   (`experiments/issue-335/`), apply the fix, and check that the test passes.
4. Run the whole JS and Rust test suites, lint and format checks.

## 4. Edit and write tools (report A)

Full report: [`analysis/A-edit-write-patch.md`](analysis/A-edit-write-patch.md).
Reproductions: [`experiments/issue-335/edit-write/`](../../../experiments/issue-335/edit-write/).
Tests: `js/tests/edit-write-reliability.ts`, `rust/tests/tool_edit.rs`,
`rust/tests/tool_write.rs`.

| Defect (before)                                                                                  | Upstream         | Fix                                                                                                               | JS  | Rust                            |
| ------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------- | --- | ------------------------------- |
| Parallel edits of one file read the same content; the last write won and other edits were lost   | #4388, #23483    | `FileTime.withLock` serializes read-modify-write per normalized path; `edit` and `write` both take it             | ✅  | n/a (sequential)                |
| Block-anchor fuzzy match accepted **any** block whose first and last lines matched               | #30932           | Similarity thresholds 0.0/0.3 → 0.65; block size must be within 25 % of `oldString`; disproportionate-match guard | ✅  | ✅                              |
| Empty `oldString` on an existing file silently replaced the whole file                           | #30932           | Rejected with an explicit error; still allowed for creating a new file                                            | ✅  | ✅                              |
| `replace(content, '', …)` looped forever                                                         | (found here)     | `replace()` rejects an empty `oldString`                                                                          | ✅  | ✅                              |
| CRLF files: LF `oldString` did not match, or the edited part was written with LF                 | #9443            | `oldString`/`newString` converted to the file's line ending                                                       | ✅  | ✅                              |
| Mixed-ending files: one CRLF anywhere made all inserted lines CRLF; Rust rewrote untouched lines | #53166           | Dominant line ending for new lines; Rust maps the result back line by line                                        | ✅  | ✅                              |
| Rust: fuzzy matches on CRLF files reported success but did not change the file                   | (found here)     | Replacers run on the LF view; endings restored afterwards                                                         | —   | ✅                              |
| UTF-8 BOM dropped by `edit` and `write`                                                          | #23797           | `Bom` helper splits/re-adds the BOM; no double BOM                                                                | ✅  | ✅                              |
| `replaceAll` treated `$&`, `$1`, `$'` in `newString` as patterns                                 | (String#replace) | `split/join` instead of `String#replaceAll`                                                                       | ✅  | n/a (Rust `replace` is literal) |
| "Modified since read" false positives for files with a future mtime; misses within the same ms   | #17835           | FileTime stores an `{mtime, size}` stamp and compares for equality                                                | ✅  | n/a (no FileTime)               |
| `dir/./a.txt` and `dir/a.txt` were different FileTime keys                                       | #20367           | Keys normalized with `path.resolve` + `realpath`                                                                  | ✅  | n/a                             |
| `edit` right after `write` failed with "You must read the file"                                  | —                | `write` records a read                                                                                            | ✅  | n/a                             |
| Empty output after a successful edit/write confused some models                                  | `66f9bdab32`     | "Edit applied successfully." / "Wrote file successfully."                                                         | ✅  | ✅                              |

## 5. Read/search and bash/web tools (reports B and C)

Full reports: [`analysis/B-read-search.md`](analysis/B-read-search.md),
[`analysis/C-bash-web.md`](analysis/C-bash-web.md).

Reproductions: [`experiments/issue-335/read-search/`](../../../experiments/issue-335/read-search/),
[`experiments/issue-335/bash-web/`](../../../experiments/issue-335/bash-web/).
Tests: `js/tests/read-search-reliability-read.ts`,
`js/tests/read-search-reliability-search.ts`,
`js/tests/bash-web-reliability.ts`, `rust/tests/tool_{read,grep,glob,bash,webfetch,websearch}.rs`.

### 5.1 Read, grep, glob, ls

| Defect (before)                                                                          | Upstream                      | Fix                                                                                  | JS  | Rust            |
| ---------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ | --- | --------------- |
| `glob`/`ls` hung after 100 results: rg blocked on a full stdout pipe while we awaited it | #10833, `76ee87ead8`          | Cancel the stream and kill rg in `finally`; abort signal passed through              | ✅  | ✅ (100 limit)  |
| `grep` returned "No files found" when rg exited 2 because one path was unreadable        | #8612, ripgrep 11 exit status | Exit 2 keeps matches and adds "(Some paths were inaccessible and skipped)"           | ✅  | n/a             |
| `grep` read stdout before stderr (deadlock on large stderr), could not be cancelled      | #39238, `4d2696e027`          | Pipes drained together; `ctx.abort` + 30 s timeout; clear errors for bad regex/paths | ✅  | n/a             |
| `grep` skipped hidden files (`.github/`)                                                 | #7501                         | `--hidden` and `--glob=!**/.git/**`                                                  | ✅  | ✅              |
| `glob` followed symlinked directories (cyclic/huge trees); user rg config changed output | #11415                        | No `--follow`; `--no-config`; ENOTDIR for a file path                                | ✅  | n/a             |
| `read` resolved relative paths against the worktree root, unlike every other tool        | `6cf2c3e3db`                  | Resolved against the session directory                                               | ✅  | n/a             |
| `read` could return megabytes (2000 lines × 2000 chars, unlimited `limit`)               | #14009, #51011                | 50 KB cap with an `offset=` hint; `limit` ≤ 2000                                     | ✅  | ✅              |
| `read` loaded a whole file to sniff 4 KB for binary content                              | #14009                        | Reads a 4 KB sample                                                                  | ✅  | ✅              |
| `read` of CRLF files leaked `\r`; a trailing newline counted as an extra line            | `c1b03b728a`, `683d470fe4`    | Split on `\r?\n`, drop the final empty line                                          | ✅  | ✅ (guard test) |
| Screenshot names with U+202F / curly quotes were "not found"                             | #45807, #50953                | Unique directory entry matched after canonicalizing                                  | ✅  | ✅              |
| Reading a directory or past the end gave confusing output                                | #33255, #33260                | Explicit errors                                                                      | ✅  | ✅              |
| SVG/BMP/TIFF/ICO/AVIF sent as images                                                     | #21114                        | **Not ported** — the fork supports these on purpose (86f24ac, maintainer request)    | —   | —               |

### 5.2 Bash, webfetch, websearch, codesearch, task

| Defect (before)                                                                                      | Upstream        | Fix                                                                                           | JS  | Rust            |
| ---------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- | --- | --------------- |
| `bash` ran `/bin/sh` (dash on Debian/Ubuntu), so bash syntax failed                                  | #3494, #5205    | `$SHELL` if usable, else bash (zsh on macOS); fish/nu fall back                               | ✅  | already bash    |
| Long output kept the start and dropped the end, where errors are                                     | #22660, #39403  | Keep the last 2000 lines / 30 KB with a `...output truncated...` prefix                       | ✅  | ✅              |
| Truncation could split a UTF-8 character (Rust panicked)                                             | —               | Per-stream `TextDecoder`; cut on character boundaries                                         | ✅  | ✅              |
| Every output chunk re-published the whole output as metadata                                         | #22660, #41007  | Bounded preview                                                                               | ✅  | n/a             |
| `echo x > file` matched an `echo*` allow rule in read-only/plan mode                                 | #6737 (adapted) | Write redirects checked as a separate `>` command; `/dev/null` and `2>&1` exempt              | ✅  | already handled |
| tree-sitter trees leaked in the WASM heap                                                            | #24861          | `tree.delete()` in `finally`                                                                  | ✅  | n/a             |
| Rust `bash` deadlocked when stderr filled its pipe; lost output on timeout; signals unreported       | (found here)    | Both pipes read concurrently; partial output kept; signal name reported                       | n/a | ✅              |
| `Tool.define` stacked another execute wrapper on every init                                          | #16952          | Copy the definition before wrapping                                                           | ✅  | n/a             |
| Web tools: timeout did not cover the body; 5 MB limit checked only after reading it all              | #21378, #33259  | `AbortSignal.timeout`; bounded streaming reader (`util/read-bounded.ts`, `read_body_bounded`) | ✅  | ✅              |
| Cloudflare challenge 403 returned as an error                                                        | #10328, #8284   | One retry with an honest user agent; a plain 403 is not retried                               | ✅  | ✅              |
| `webfetch` required `format`                                                                         | #6345, #30215   | Optional, markdown by default                                                                 | ✅  | ✅              |
| HTML-to-text dropped text that follows a `<script>`/`<style>` element                                | #26309          | Skipped                                                                                       | ✅  | n/a             |
| Exa: `EXA_API_KEY` ignored, plain-JSON replies rejected, errors unlabeled, stale year in description | #16362, #13559  | Shared client (`util/exa-mcp.ts`, Rust equivalent)                                            | ✅  | ✅              |
| `task` kept its event subscription after an error                                                    | #9992           | `try/finally` around `unsub()`                                                                | ✅  | n/a             |

## 6. Session, provider and MCP fixes (report D)

Full report: [`analysis/D-session-provider.md`](analysis/D-session-provider.md).
These parts exist only in the JS implementation; the Rust port has no session
loop, provider layer or MCP client yet.

Tests: `js/tests/session-reliability.ts`,
`js/tests/provider-transform-reliability.ts`, `js/tests/mcp-reliability.ts`
(with the stdio fixture `js/tests/fixtures/mcp-server.js`).

### 6.1 Session loop, errors and retry

| #   | Defect (before)                                                                                                                                                   | Upstream                    | Fix                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | "Prompt is too long", HTTP 413 and mid-stream `context_length_exceeded` ended the session with an `APIError`                                                      | #6480, #12768, #14707       | `ContextOverflowError`; the processor returns `'compact'`, the loop compacts and continues; a second overflow stops |
| 2   | Stream error objects with a string `code` (`server_error`) were misread, so retryable 5xx were never retried                                                      | #12768, `027d43b5ea`        | Numeric `statusCode` is read first; the string code is kept as the error type                                       |
| 3   | Finish reason `stop` after tool calls ended the loop before results reached the model                                                                             | #14973, #26178              | `hasToolCalls()` keeps the loop going when the last step has completed tool calls                                   |
| 16  | An invalid tool call stored the raw string input; Gemini returned 400 on every later turn                                                                         | #21709                      | Non-object input is stored as `{ value }`                                                                           |
| 17  | Aborted tools lost their start time and could not be told apart from failures; open text was never closed                                                         | #27254, #26178, #21598      | `interrupted: true` marker, start time and partial output kept, open text/reasoning parts finalized                 |
| 18  | 5xx marked non-retryable, plain-text rate limits, Vertex `RESOURCE_EXHAUSTED`, OpenAI item 404, `ZlibError`                                                       | #10590, #24063, #19104      | Classified as retryable                                                                                             |
| 19  | API errors showed raw SDK text or whole HTML pages                                                                                                                | `4fd576f3af`, #15407        | `apiErrorMessage()` adds the error message from a JSON body; HTML 401/403 pages become a short explanation          |
| 20  | A tool call or result that arrived without `tool-input-start` was dropped                                                                                         | #21709                      | `ensureToolCall()` creates the part on demand                                                                       |
| 21  | `cancel()` rejected queued callers with `undefined`                                                                                                               | `6c9b2c37a5`                | Rejected with a `DOMException` `AbortError`                                                                         |
| 24  | A retry delay above 2^31−1 ms fired immediately (hot retry loop)                                                                                                  | upstream `retry.ts` `cap()` | Every delay capped at 2 147 483 647 ms                                                                              |
| 25  | Reasoning tokens were charged twice                                                                                                                               | #21047                      | `output = outputTokens − reasoningTokens`                                                                           |
| own | `maxOutputTokens` got the provider ID instead of the npm package, so the Anthropic thinking-budget branch never ran                                               | (found here)                | Passes `model.npm`                                                                                                  |
| own | When `retry-after` exceeded the retry timeout, `process()` left with `break` and returned `undefined`, so the loop started another step with a fresh retry budget | (found here)                | The error takes the normal final-error path and the turn stops                                                      |
| own | `RetryTimeoutExceededError`, `SocketConnectionError` and `TimeoutError` were missing from the message error union, so saving them threw a `ZodError`              | (found here)                | Added to the union                                                                                                  |

### 6.2 Provider message transforms

| #   | Defect (before)                                                                                      | Upstream                | Fix                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| 5   | Lone UTF-16 surrogates (cut emoji) reached the provider: HTTP 400 "invalid Unicode"                  | #25934                  | Replaced with U+FFFD in every text field                                                   |
| 6   | Empty text/reasoning parts and empty messages went to Anthropic/Bedrock: 400                         | upstream `transform.ts` | Filtered for those providers                                                               |
| 7   | Signatures and reasoning from another model were replayed (model cascade, summary model): 400        | `021e42c0bb1`           | `toModelMessage(msgs, target)` drops foreign provider metadata and sends reasoning as text |
| 12  | Signed reasoning with an empty text part lost its block                                              | #21370                  | Sends `" "`                                                                                |
| 13  | `applyCaching` replaced existing provider options with a shallow spread                              | #10323                  | `mergeDeep`                                                                                |
| 14  | Bedrock used the wrong cache-point shape                                                             | #11664, #18959          | `cachePoint: { type: 'default' }` at message level                                         |
| 15  | Moonshot/Kimi rejected schemas with `$ref` siblings or tuple `items`; MCP schemas skipped `schema()` | #24730, #11984          | Schemas sanitized; MCP tools go through `ProviderTransform.schema`                         |
| 22  | A user message whose parts all converted to nothing became `content: []`                             | #4811                   | Such messages are dropped                                                                  |

### 6.3 MCP client

| #   | Defect (before)                                                                                      | Upstream                     | Fix                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| 4   | A server that never answered `initialize` blocked every session                                      | #6760, #19200                | Connect timeout (`timeout` or 30 s); the transport is closed on failure                |
| 8   | `tools/list` had no timeout, looped on a repeated cursor, ran sequentially and leaked failed clients | #31442, #13229, `e5abe1e78b` | Per-request timeout, 1000-page cap, repeated-cursor error, parallel listing, `close()` |
| 9   | Results without `content`, with resources or with only `structuredContent` crashed or were dropped   | #7879, #32244, #57640        | `normalizeResult()`                                                                    |
| 10  | An invalid URL or an exception during creation removed the server silently                           | #25019, #31595               | `failed` status with the reason                                                        |
| 11  | A server without the `tools` capability was marked failed                                            | #31271, #55474               | Treated as no tools, still connected                                                   |
| 23  | Dispose left grandchild processes running                                                            | #15516                       | Descendants found with `pgrep -P` and sent SIGTERM                                     |
| own | The tool timeout rejected the promise but the MCP request kept running                               | (found here)                 | `callWithTimeout()` aborts the request                                                 |
| own | `getToolTimeout` split on the first `_`, so servers named `my_server` never matched                  | (found here)                 | Longest configured server prefix wins                                                  |
| own | `const config = cfg.mcp` shadowed the `config` import, so connect timeouts were `NaN`                | (found while porting #4)     | Renamed to `servers`                                                                   |

### 6.4 Not ported and known remaining issues

- Upstream replays the user message that overflowed once compaction is done.
  Here the existing compaction flow is kept: the summary covers the request,
  and a synthetic "Continue if you have next steps" message resumes the turn.
- When a model overflows, the compaction model cascade does not move on to
  the next model; the overflow is reported instead.

## 7. Upstream practices adopted

- Every fix has a regression test that fails without it.
- File mutations are serialized per canonical path; tool calls of one step and
  `batch` run concurrently, so this is required for correctness.
- File identity is the canonical path (`realpath`), not the string the model
  sent.
- "Modified since read" is decided by comparing file stamps for equality,
  never by comparing clocks.
- Fuzzy matching is bounded: it must not be able to replace text that is much
  larger than, or very different from, what the model asked to replace.
- Round-trips keep the file's bytes: BOM and line endings are preserved, and
  untouched lines are never rewritten.
- Tools return a short confirmation instead of an empty string.
- Every external call has a deadline and is cancelled on abort: rg, web
  requests, MCP connect, `tools/list` and tool calls. A timeout that only
  rejects the promise is not enough; the request itself is aborted.
- Loops driven by remote data are bounded (MCP pagination, retry delays).
- Child processes are cleaned up on every exit path, including grandchildren.
- Errors are classified by structure first (status code, error code), then by
  message patterns, and only overflow and transient errors are acted on.
- Messages sent to a provider are sanitized for what that provider rejects
  (lone surrogates, empty blocks, foreign signatures).

## 8. Online research

- **Line endings in agent edit tools are a common failure.** Public bug
  reports for other coding agents describe the same three symptoms we fixed:
  `oldString` not matching on CRLF files because the read output is
  LF-normalized, unrelated lines being converted from CRLF to LF, and false
  "file modified" errors from comparing LF and CRLF versions. See for example
  the Claude Code reports mirrored at
  [claudeissues.com #62713](https://claudeissues.com/issue/62713-bug-built-in-edit-tool-silently-converts-line-endings-crlf-lf-in-unrelated-lines),
  [#54876](https://claudeissues.com/issue/54876-bug-edit-tool-fails-on-windows-with-crlf-line-endings-read-output-mismatches-fil),
  [#64599](https://claudeissues.com/issue/64599-bug-edit-raises-file-has-been-unexpectedly-modified-on-crlf-files-write-silently)
  and the Cursor thread
  [Cursor converts line endings on Windows](https://forum.cursor.com/t/cursor-converts-line-endings-on-windows/150424).
- **UTF-8 BOM.** `TextDecoder` strips a leading BOM unless `ignoreBOM: true`
  is passed. The `ignoreBOM` default is `false`, as the web-platform test
  [textdecoder-ignorebom](https://cobalt.googlesource.com/cobalt/+/master%5E/third_party/web_platform_tests/encoding/textdecoder-ignorebom.html)
  checks. The 2012 WHATWG discussion
  ([thread](https://lists.whatwg.org/pipermail/whatwg-whatwg.org/2012-August/079197.html))
  notes that Windows tools use the BOM to tell UTF-8 from the legacy code
  page, so dropping it on write-back can change how a file is read. This is
  why `Bom.readFile` decodes with `ignoreBOM: true` and re-adds the BOM
  itself.
- **ripgrep exit status.** Since ripgrep 11.0.0, exit status 2 is returned
  for any error, including soft errors such as an unreadable file, _even when
  matches were found_
  ([release notes](https://github.com/BurntSushi/ripgrep/releases/tag/11.0.0)).
  A grep tool that treats status 2 as "no results" therefore drops valid
  matches.

## 9. Existing components and libraries

| Need                                | Component considered                                  | Decision                                                                                 |
| ----------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Per-file mutual exclusion           | `async-mutex`, `p-limit`, upstream Effect `Semaphore` | A ~20-line promise chain (`FileTime.withLock`), as upstream #4388 did; no new dependency |
| BOM handling                        | `strip-bom`, `TextDecoder({ ignoreBOM })`             | Built-in `TextDecoder` plus a small `Bom` helper                                         |
| Line diff for ending restore (Rust) | `similar` (already a dependency)                      | `TextDiff::from_lines` maps unchanged lines back to their raw bytes                      |
| String similarity                   | `fastest-levenshtein`, `strsim` (Rust)                | Existing in-tree Levenshtein (JS) and a small two-row implementation (Rust)              |
| Search                              | `ripgrep` (already used)                              | Kept; exit-status and process handling fixed                                             |
| Deep merge of provider options      | `remeda` `mergeDeep` (already a dependency)           | Used in `applyCaching`, as upstream does                                                 |
| MCP client timeouts                 | `@ai-sdk/mcp` request options, `AbortSignal.timeout`  | Built-in per-request timeouts and abort signals; no wrapper library                      |
| Process tree cleanup                | `tree-kill`, `pidtree`                                | `pgrep -P` walk, as upstream #15516 does; no new dependency                              |
| Bounded response reading            | `raw-body`, `stream-size`                             | A small reader over `ReadableStream` (`util/read-bounded.ts`)                            |

## 10. Verification

Run on 2026-10-22 with Bun 1.4.3 on Linux.

| Check                                                                 | Result                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| `cd js && bun test --timeout 30000 ./tests/*.js ./tests/*.ts`         | 1150 pass, 4 todo, 0 fail (91 files) |
| `cd js && npm run check` (eslint, prettier, file size)                | clean                                |
| `cd rust && cargo fmt --all -- --check`                               | clean                                |
| `cd rust && cargo clippy --all-targets --all-features -- -D warnings` | clean                                |
| `cd rust && cargo test`                                               | 479 pass, 0 fail                     |

The regression tests were written first, to reproduce each defect, and the
fixes were made afterwards. The reproduction scripts in `experiments/issue-335/` show the original
behaviour without the test harness.

New test files:

- edit/write: `js/tests/edit-write-reliability.ts`, `rust/tests/tool_edit.rs`, `rust/tests/tool_write.rs`
- read/search: `js/tests/read-search-reliability-read.ts`, `js/tests/read-search-reliability-search.ts`
- bash/web: `js/tests/bash-web-reliability.ts`
- session/provider/MCP: `js/tests/session-reliability.ts`, `js/tests/provider-transform-reliability.ts`, `js/tests/mcp-reliability.ts`
