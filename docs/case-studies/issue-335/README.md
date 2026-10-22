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

| #   | Requirement (from the issue text)                                                    | Where it is handled                                     |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| R1  | Include upstream code that increases the reliability of our code                     | §4–§6, commits in PR #339                               |
| R2  | Use upstream best practices                                                           | §3 (method), §7 (practices adopted)                     |
| R3  | Do **not** add support for additional tools                                          | §2.3 — no tool was registered or added                  |
| R4  | Only fix existing tools where we have potential issues                               | §4–§5: every port is a fix to an existing tool          |
| R5  | Collect the data related to the issue into `./docs/case-studies/issue-335`          | `data/`, `analysis/`                                    |
| R6  | Do a deep case study analysis, including online research for additional facts       | this file, `analysis/*.md`, §8                          |
| R7  | List each and all requirements from the issue                                         | this table                                              |
| R8  | Propose possible solutions and a solution plan for each requirement                  | §4–§6 (per-defect solution + status)                    |
| R9  | Check known existing components/libraries that solve or help solve the problem       | §9                                                      |
| R10 | Plan and execute everything in this single pull request                               | PR #339                                                 |

## 2. Context and timeline

### 2.1 Where the fork comes from

| Date       | Event                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 2025-11-19 | Fork base: upstream commit `0068cb305f`. Our `js/` tree is a copy of `packages/opencode` from that time. |
| 2025-12-15 | Upstream #4388 adds a per-file lock to `edit` (read-before-write race).                                 |
| 2026-03-07 | Upstream #9443 preserves CRLF line endings in `edit`.                                                   |
| 2026-03-16 | Upstream #17835 replaces the wall-clock read time with an `{mtime, size}` stamp.                         |
| 2026-04-01 | Upstream #20367 normalizes paths used as FileTime keys.                                                  |
| 2026-04-16 | Upstream #22999 deletes the FileTime module (moved into the Effect-based tool runtime).                 |
| 2026-04-20 | Upstream #23483 re-adds per-file edit locking after the Effect refactor.                                |
| 2026-04-22 | Upstream #23797 preserves the UTF-8 BOM in text tool round-trips.                                       |
| 2026-06-05 | Upstream #30932 stops destructive fuzzy edit matches.                                                   |
| 2026-07-20 | Upstream `44b6938b2a` deletes `packages/opencode`; the code now lives in `packages/core`.               |
| 2026-10-12 | Upstream #53166 preserves mixed line endings in `edit`.                                                 |
| 2026-10-22 | Upstream HEAD `d93568f334` (last tag `github-v1.2.27`). Issue #335 opened.                              |

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

| Defect (before)                                                                                   | Upstream          | Fix                                                                                                         | JS | Rust |
| ------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- | -- | ---- |
| Parallel edits of one file read the same content; the last write won and other edits were lost    | #4388, #23483     | `FileTime.withLock` serializes read-modify-write per normalized path; `edit` and `write` both take it       | ✅ | n/a (sequential) |
| Block-anchor fuzzy match accepted **any** block whose first and last lines matched                | #30932            | Similarity thresholds 0.0/0.3 → 0.65; block size must be within 25 % of `oldString`; disproportionate-match guard | ✅ | ✅ |
| Empty `oldString` on an existing file silently replaced the whole file                            | #30932            | Rejected with an explicit error; still allowed for creating a new file                                     | ✅ | ✅ |
| `replace(content, '', …)` looped forever                                                          | (found here)      | `replace()` rejects an empty `oldString`                                                                    | ✅ | ✅ |
| CRLF files: LF `oldString` did not match, or the edited part was written with LF                  | #9443             | `oldString`/`newString` converted to the file's line ending                                                | ✅ | ✅ |
| Mixed-ending files: one CRLF anywhere made all inserted lines CRLF; Rust rewrote untouched lines   | #53166            | Dominant line ending for new lines; Rust maps the result back line by line                                 | ✅ | ✅ |
| Rust: fuzzy matches on CRLF files reported success but did not change the file                    | (found here)      | Replacers run on the LF view; endings restored afterwards                                                   | —  | ✅ |
| UTF-8 BOM dropped by `edit` and `write`                                                            | #23797            | `Bom` helper splits/re-adds the BOM; no double BOM                                                          | ✅ | ✅ |
| `replaceAll` treated `$&`, `$1`, `$'` in `newString` as patterns                                   | (String#replace)  | `split/join` instead of `String#replaceAll`                                                                 | ✅ | n/a (Rust `replace` is literal) |
| "Modified since read" false positives for files with a future mtime; misses within the same ms     | #17835            | FileTime stores an `{mtime, size}` stamp and compares for equality                                         | ✅ | n/a (no FileTime) |
| `dir/./a.txt` and `dir/a.txt` were different FileTime keys                                         | #20367            | Keys normalized with `path.resolve` + `realpath`                                                           | ✅ | n/a |
| `edit` right after `write` failed with "You must read the file"                                    | —                 | `write` records a read                                                                                      | ✅ | n/a |
| Empty output after a successful edit/write confused some models                                    | `66f9bdab32`      | "Edit applied successfully." / "Wrote file successfully."                                                   | ✅ | ✅ |

## 5. Read/search and bash/web tools (reports B and C)

Full reports: [`analysis/B-read-search.md`](analysis/B-read-search.md),
[`analysis/C-bash-web.md`](analysis/C-bash-web.md).

<!-- B/C results are filled in below once implemented. -->

## 6. Session, provider and MCP fixes (report D)

<!-- Filled in once triaged and implemented. -->

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

| Need                          | Component considered                                     | Decision                                                                                     |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Per-file mutual exclusion     | `async-mutex`, `p-limit`, upstream Effect `Semaphore`    | A ~20-line promise chain (`FileTime.withLock`), as upstream #4388 did; no new dependency     |
| BOM handling                  | `strip-bom`, `TextDecoder({ ignoreBOM })`                 | Built-in `TextDecoder` plus a small `Bom` helper                                             |
| Line diff for ending restore (Rust) | `similar` (already a dependency)                    | `TextDiff::from_lines` maps unchanged lines back to their raw bytes                         |
| String similarity             | `fastest-levenshtein`, `strsim` (Rust)                    | Existing in-tree Levenshtein (JS) and a small two-row implementation (Rust)                  |
| Search                        | `ripgrep` (already used)                                  | Kept; exit-status and process handling fixed                                                |

## 10. Verification

<!-- Filled in with final test numbers. -->
