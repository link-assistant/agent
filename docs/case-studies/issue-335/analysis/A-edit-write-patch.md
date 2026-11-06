# A: edit / write / patch, upstream reliability fixes missing from our fork

- Fork base: upstream `0068cb305f` (2025-11-19).
- Our code: `/tmp/gh-issue-solver-1792704263647/js/src/tool/{edit,write,patch,multiedit}.ts`, `js/src/file/time.ts`, and `rust/src/tool/{edit,write}.rs`.
- Experiments: `/tmp/upstream/analysis/experiments-A/`, run with `bun <file>`.

Two facts about our tool set shape the verdicts below:

- **The patch tool is not registered.** `tool/registry.ts` registers Invalid, Bash, Read, Glob, Grep, List, Edit, Write, Task, WebFetch, WebSearch, CodeSearch, Batch, TodoWrite and TodoRead. `patch.ts` and `multiedit.ts` are dead code, so patch-only fixes are NOT-APPLICABLE until patch is re-enabled.
- **JS tool calls run concurrently.** The AI SDK runs one step's tool calls concurrently, and `batch` uses `Promise.all` (`js/src/tool/batch.ts:139`). Rust runs tool calls sequentially (there is no `join_all` or `spawn` in `rust/src`).

---

## 1. Lost update when two edits hit the same file in parallel (HIGH)

- **Upstream:**
  - `5cf126d489` (#4388, 2025-12-15) added `FileTime.withLock`.
  - `8bc4f91fd9` (#23483, 2026-04-20) re-added the lock after the Effect refactor, keyed by realpath.
  - `bc47030d4d` (#40641, 2026-08-07) shares one lock across edit and patch and takes the locks in sorted order.
- **Bug:** the model issues two `edit` calls on one file in a single step, or inside `batch`. Both read the original content, and the second write overwrites the first. Both calls report success, but one edit is silently lost.
- **Ours:**
  - `js/src/tool/edit.ts:64-113` runs read (`:83`), replace (`:84`) and write (`:100`) with no lock.
  - `FileTime.read` runs after the block, at `:115`.
  - `write.ts:39` has no lock either.
- **Proof:** `experiments-A/01-parallel-edits.ts` runs two concurrent `EditTool.execute` calls (`top = 0` → `top = 1`, and `bottom = 0` → `bottom = 2`). In **19 of 20 runs both calls fulfilled but one edit was lost**, for example `"top = 1\nmiddle = keep\nbottom = 0\n"`.
- **Verdict: PORT.**

Upstream snippet (5cf126d489, non-Effect):

```ts
// file/time.ts, inside the state() object: add `locks: new Map<string, Promise<void>>()`
export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
  const current = state()
  const currentLock = current.locks.get(filepath) ?? Promise.resolve()
  let release: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => { release = resolve })
  const chained = currentLock.then(() => nextLock)
  current.locks.set(filepath, chained)
  await currentLock
  try { return await fn() } finally {
    release()
    if (current.locks.get(filepath) === chained) current.locks.delete(filepath)
  }
}
```

How to apply it:

- In `edit.ts`, replace `await (async () => { ... })()` (`:64`) with `await FileTime.withLock(lockKey, async () => { ... })`.
- Move `FileTime.read(ctx.sessionID, filePath)` (`:115`) inside the callback, as its last statement.
- Use a canonical lock key, as 8bc4f91fd9 does: `const lockKey = await fs.realpath(filePath).catch(() => path.resolve(filePath))`.
- Wrap `write.ts:35-39` in the same `withLock`.
- Alternative: reuse the existing `js/src/util/lock.ts` with `using _ = await Lock.write('edit:' + lockKey)`.

Minimal test (fails today, roughly 95% of runs; loop 10 times to make it deterministic):

```ts
await Bun.write(f, "top = 0\nmiddle = keep\nbottom = 0\n"); FileTime.read(sid, f)
await Promise.all([
  EditTool.execute({ filePath: f, oldString: "top = 0", newString: "top = 1" }, ctx),
  EditTool.execute({ filePath: f, oldString: "bottom = 0", newString: "bottom = 2" }, ctx),
])
expect(await Bun.file(f).text()).toBe("top = 1\nmiddle = keep\nbottom = 2\n")
```

**Rust:** not affected today, because tool calls run sequentially. Add a lock only if parallel tool execution is introduced.

---

## 2. Destructive fuzzy matches and empty `oldString` overwrite (HIGH)

- **Upstream:** `236cfcbbc3` (#30932, 2026-06-05).
- **Bug A, BlockAnchorReplacer:**
  - The model sends a short `oldString` whose first and last lines match a much larger block. An example is `function configure() {\n  const enabled = true\n}` against a 6-line function.
  - Our single-candidate threshold is `0.0` (`edit.ts:150`), so any anchor match is accepted. The whole block is replaced and `removeAllUserData()` and the other lines are deleted.
- **Bug B, empty `oldString`:**
  - `edit.ts:65-75` calls `Bun.write(filePath, newString)` with no existence check and no `FileTime.assert`.
  - An edit with `oldString: ""` on an existing file therefore replaces the whole file with the snippet.
- **Ours:**
  - `edit.ts:150-151`: thresholds are `0.0` / `0.3`.
  - `edit.ts:250`: `candidates.push({ startLine: i, endLine: j })` with no block-size check.
  - `replace()` (`:625-671`) has no empty or disproportionate-match guard.
- **Verdict: PORT.** This is pure-function code with no Effect dependencies.

Upstream snippet:

```ts
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.65

// BlockAnchorReplacer, before the candidate loop:
const maxLineDelta = Math.max(1, Math.floor(searchBlockSize * 0.25))
// replace `candidates.push({ startLine: i, endLine: j })` with:
if (Math.abs(j - i + 1 - searchBlockSize) <= maxLineDelta) candidates.push({ startLine: i, endLine: j })

function isDisproportionateMatch(search: string, oldString: string) {
  const oldLines = oldString.split("\n").length
  const searchLines = search.split("\n").length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}
```

How to apply it:

- **In `replace()`:**
  - At the top, add `if (oldString === "") throw new Error("oldString cannot be empty")`.
  - Inside the replacer loop, right after `notFound = false`, add `if (isDisproportionateMatch(search, oldString)) throw new Error("Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.")`.
- **In `execute`:** change the `oldString === ''` branch (`:65`) so it throws when the file already exists: `"oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement."`. Keep creation for files that do not exist.

Minimal tests (both fail today):

```ts
const src = "function configure() {\n  keepImportantState()\n  removeAllUserData()\n  archiveBackups()\n  auditLog()\n}"
expect(() => replace(src, "function configure() {\n  const enabled = true\n}", "x")).toThrow()
// execute: existing file + oldString "" must reject, and the file must stay unchanged
```

**Rust: PORT, and it is worse there.**

- `rust/src/tool/edit.rs:403-440`: `try_block_anchor_replace` has **no similarity check at all**, so any first/last-line match is accepted.
- `edit.rs:93-94`: an empty `old_string` calls `fs::write` on an existing file.

---

## 3. FileTime check breaks on future mtimes and unnormalized paths (MEDIUM)

- **Upstream:**
  - `2cbdf04ec9` (#17835, 2026-03-16) stores a stat stamp `{read, mtime, size}` and compares for equality instead of comparing against wall-clock time. The ctime field was dropped later.
  - `8bc4f91fd9` and its successors key FileTime by resolved path.
- **Bug A, future mtime:**
  - The file has an mtime in the future. Causes include clock skew, a checkout from another machine, `touch -d`, or network filesystems.
  - `assert` compares `stats.mtime > readTime(new Date())`, so the file can **never** be edited, even immediately after a read.
  - Fast writers with coarse mtime resolution can also slip past the check: an external write landing within the same timestamp tick is not detected.
- **Bug B, path normalization:**
  - `read` resolves the path one way, for example `dir/a.txt`, and `edit` gets `dir/./a.txt`, `dir/x/../a.txt` or a trailing-slash variant.
  - The result is "You must read the file … before overwriting it".
  - A fork-specific aggravation: `read.ts:38-41` resolves relative paths against `Instance.worktree`, while `edit.ts:46-48` and `write.ts:19-21` use `Instance.directory`. When those differ, the keys differ too.
- **Ours:** `js/src/file/time.ts` stores `new Date()` and asserts `stats.mtime.getTime() > time.getTime()`. Keys are stored as given.
- **Proof:** `experiments-A/03-filetime-future-mtime.ts`:
  - mtime +60s, then read, then edit, fails with "has been modified since it was last read".
  - Read `dir/a.txt` then edit `dir/./a.txt` fails with "You must read the file…".
- **Verdict: PORT.**

How to apply it:

- **In `time.ts`:**
  - Make `read(sessionID, file)` async, or have it accept the stat result. It should store `{ read: new Date(), mtime: stat.mtimeMs, size: stat.size }` under `path.resolve(file)`.
  - `assert` should look up `path.resolve(file)`, stat the file, and throw "modified since it was last read" when `next.mtimeMs !== stamp.mtime || next.size !== stamp.size`.
  - `get` and `read` callers must use the same `path.resolve`.
- **In `edit.ts`:** call `FileTime.read` after the write, inside the lock (fix 1), so the stamp reflects our own write.
- **Fork-only fix:** make `read.ts` resolve with `Instance.directory`, the same as edit and write. Upstream uses `path.resolve(instance.directory, …)` everywhere.

Minimal test:

```ts
await Bun.write(f, "a"); await fs.utimes(f, new Date(), new Date(Date.now() + 60_000))
FileTime.read(sid, f)
await EditTool.execute({ filePath: f, oldString: "a", newString: "b" }, ctx) // throws today
```

Not applicable here:

- `880c0a7477` (#20367) is a Windows-only `normalizePath`.
- `36197f5ff8` (#14907) adds a 50ms NTFS tolerance. The stamp-equality approach makes it unnecessary.
- `76a141090e` (#22999) deletes FileTime entirely. That is a policy change, not a fix.

**Rust:** has no FileTime at all, so it does not have this bug. Adding read-before-write would be a feature.

---

## 4. CRLF files get LF fragments (MEDIUM)

- **Upstream:** `be9b4d1bcd` (#9443, 2026-03-07).
- **Bug:**
  - Models always send `\n`.
  - On a CRLF file the exact replacer misses, and a fuzzy replacer (line-trimmed) matches via `trim()`. The trim eats the `\r` of the matched region.
  - The replacement is inserted with `\n`, so the file ends up with mixed endings.
- **Ours:** `edit.ts:84-89` passes `oldString` and `newString` through unchanged. Line endings are only normalized for the diff.
- **Proof:** `experiments-A/02-bom-crlf.ts`:
  - `line1\r\nline2\r\nline3\r\n`, edited with `line1\nline2` → `line1\nnew\nline2`, becomes `"line1\nnew\nline2\nline3\r\n"`.
  - `a\r\nb\r\n` with a single-line insert becomes `"a\nx\r\nb\r\n"`.
- **Verdict: PORT.**

Upstream snippet:

```ts
function detectLineEnding(text: string): "\n" | "\r\n" { return text.includes("\r\n") ? "\r\n" : "\n" }
function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}
// execute, replacing edit.ts:84-89:
const ending = detectLineEnding(contentOld)
const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
const next = convertToLineEnding(normalizeLineEndings(params.newString), ending)
contentNew = replace(contentOld, old, next, params.replaceAll)
```

Minimal test:

```ts
await Bun.write(f, "line1\r\nline2\r\nline3\r\n")
await EditTool.execute({ filePath: f, oldString: "line1\nline2", newString: "line1\nnew\nline2" }, ctx)
expect(await Bun.file(f).text()).toBe("line1\r\nnew\r\nline2\r\nline3\r\n")
```

**Rust: PORT, and it is worse there.**

- `rust/src/tool/edit.rs:126` normalizes the **whole file** to LF before writing it (`:137`), so any edit converts an entire CRLF file to LF.
- Fix: detect the ending from the raw content, run the replace on the LF view, then convert `content_new` back to `\r\n` if the original was CRLF.

### 4b. Mixed-ending files (LOW, optional)

- **Upstream:** `0cb434775c` (#53166, 2026-10-12), in the core (Effect) edit tool.
- It matches against the LF view, maps offsets back to the source, and takes the replacement's endings from the matched region. The fallback is the region's dominant ending.
- **Verdict: optional partial PORT.** The full logic is tied to the new matcher.
- A cheap adaptation of fix 4: instead of `text.includes("\r\n")` over the whole file, pick the dominant ending, comparing the counts of `\r\n` and lone `\n`.

---

## 5. UTF-8 BOM silently stripped (MEDIUM)

- **Upstream:** `8113a4360e` (#23797, 2026-04-22), which adds `util/bom.ts` and applies it to edit, write and patch.
- **Bug:** a BOM file is edited, for example a C#/.NET or PowerShell file or a CSV opened in Excel. `Bun.file().text()` strips the BOM, and `file.write` writes the text back without it. Every edit drops the BOM, which can break consumers and creates a noisy diff.
- **Ours:**
  - `edit.ts:83` `file.text()`, then `:100` `file.write(contentNew)`.
  - `write.ts:39` `Bun.write(filepath, params.content)`.
- **Proof:** `experiments-A/02-bom-crlf.ts`. The first char code after `.text()` is `0x75`. After an edit the first bytes are `757369`, so the BOM is lost.
- **Verdict: PORT** for edit and write.

Upstream snippet:

```ts
// util/bom.ts
const BOM_CODE = 0xfeff
const BOM = String.fromCharCode(BOM_CODE)
export function split(text: string) {
  if (text.charCodeAt(0) !== BOM_CODE) return { bom: false, text }
  return { bom: true, text: text.slice(1) }
}
export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  if (!bom) return stripped
  return BOM + stripped
}
export async function readFile(p: string) {
  return split(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await Bun.file(p).arrayBuffer()))
}
```

How to apply it:

- **Edit:**
  - `const source = await Bom.readFile(filePath); contentOld = source.text`.
  - `const next = Bom.split(replace(...)); contentNew = next.text`.
  - `await Bun.write(filePath, Bom.join(contentNew, source.bom || next.bom))`.
- **Write:**
  - `const source = exists ? await Bom.readFile(filepath) : { bom: false, text: "" }`.
  - `const next = Bom.split(params.content)`.
  - `Bun.write(filepath, Bom.join(next.text, source.bom || next.bom))`.

Minimal test:

```ts
await Bun.write(f, "﻿using System;\n")
await EditTool.execute({ filePath: f, oldString: "System", newString: "System.IO" }, ctx)
expect([...new Uint8Array(await Bun.file(f).arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
```

**Rust:**

- `read_to_string` keeps U+FEFF and `fs::write` writes it back, so the BOM survives.
- However, an `old_string` that starts at line 1 won't exact-match.
- Low priority. Optionally strip U+FEFF before matching and re-prepend it on write.

---

## 6. `replaceAll: true` corrupts replacements that contain `$` (MEDIUM, extra finding)

- **Upstream:** legacy upstream `edit.ts` has the same bug. The core rewrite avoids it by slicing. There is no dedicated commit.
- **Bug:**
  - `edit.ts:653` is `content.replaceAll(search, newString)`.
  - A string replacement interprets `$$`, `$&`, `` $` `` and `$'`.
  - Example: replacing `A` with `$$5 and $& done` yields `$5 and A done`.
  - This breaks shell, PHP, jQuery, template-literal and regex code.
- **Proof:** `experiments-A/04-replaceall-dollar.ts` prints `"price = $5 and A done\n…"`, so the bug is confirmed.
- **Verdict: PORT** as a one-line fix: `return content.split(search).join(newString);`, or `content.replaceAll(search, () => newString)`.
- The single-match path uses substring concatenation and is safe.

Test:

```ts
expect(replace("x=A\ny=A\n", "A", "$$5 $&", true)).toBe("x=$$5 $&\ny=$$5 $&\n")
```

**Rust:** `str::replace` is literal, so it is not affected.

---

## 7. Write tool lost its read-before-overwrite check and Edited event (MEDIUM, fork regression)

- **Upstream base:** base `write.ts` at `0068cb305f` already had all three of `if (exists) await FileTime.assert(...)`, `Bus.publish(File.Event.Edited, …)` and `FileTime.read(...)`. Our fork removed them.
- **Bug:**
  - `write` can overwrite a file the model never read, or one changed externally since it was read, with no error.
  - Edited subscribers are not notified.
  - A subsequent `edit` after a `write` fails "You must read the file…", because write does not record a FileTime.
- **Ours:** `js/src/tool/write.ts:35-48` has no assert, no publish and no read.
- **Verdict: PORT.** This restores base behaviour:
  - `if (exists) await FileTime.assert(ctx.sessionID, filepath)` before `Bun.write`.
  - Then `await Bus.publish(File.Event.Edited, { file: filepath })` and `FileTime.read(ctx.sessionID, filepath)`.
  - Do all of this inside the lock from fix 1.
- If dropping the check was a deliberate fork decision, at least restore `FileTime.read` so that write followed by edit works.

Test: `FileTime.read` is never called for the file, so `WriteTool.execute` on that existing file should throw, but it succeeds today. Also, `edit` immediately after `write` should succeed, but it throws today.

---

## 8. Empty tool output reads as failure to the model (LOW)

- **Upstream:** `66f9bdab32` (2026-01-12).
- **Bug:** edit and write return `output: ''` (`edit.ts:117`, `write.ts:48`). Some models interpret an empty tool result as "nothing happened" and retry or re-apply the edit, which can produce a duplicate insertion via the fuzzy replacers.
- **Verdict: PORT.** Set `output = "Edit applied successfully."` in edit and `"Wrote file successfully."` in write.
- **Rust: PORT.** `rust/src/tool/edit.rs:101,157` and `rust/src/tool/write.rs:85` all use `String::new()`.

---

## 9. Patch tool fixes: NOT-APPLICABLE while patch is unregistered

| Commit | Fix | Verdict |
|---|---|---|
| `eb4ff91c2d` (#38034) | Several `*** Update File:` hunks on the same file in one patch. Each hunk re-reads from disk, so the second update overwrites the first. | N/A, dead code. PORT if patch is re-enabled: keep a `Map<path, content>` of pending updates and derive from it. |
| `74bd52e8a7` | The patch tool did not publish `File.Event.Edited`. Ours publishes only `FileWatcher.Event.Updated`. | N/A, dead code. |
| `8d9727be9f` (#38369), `63e2054f50` (#38016) | Patch error messages. | N/A, error-message quality on dead code. |
| `455b5d3165` (#37709), `8c758e443b` (#41186) | Core patch parity and refactor. | N/A, refactor. |
| `e8fa6985bc` (#42667) | Permission and external-dir path resolution in core patch. | N/A, permission/Location refactor. |

`multiedit.ts` is also unregistered. If it is re-enabled, it needs the same lock (fix 1) around its sequential loop so that it is atomic per file.

## 10. Other NOT-APPLICABLE commits (feature, refactor or out of scope)

- `c9ea966805`: `DISABLE_FILETIME_CHECK` flag (feature).
- `76a141090e`: removes FileTime (policy change).
- `7211c9934a`: forgiving-matching feature.
- `f15398efc3`, `9200e353bf`: output and guidance wording.
- `a609174969`: `~` expansion (feature).
- `b7ad6bd839`: the new `apply_patch` tool.
- All LSP-diagnostics and formatter commits. We have no LSP and no formatter.
- The Effect refactors of edit, write and patch.
- `880c0a7477` and `36197f5ff8`: Windows-only FileTime fixes, made unnecessary by fix 3.

---

## Summary

| # | Fix | Upstream | JS | Rust |
|---|---|---|---|---|
| 1 | Per-file lock (lost parallel edits) | 5cf126d489 / 8bc4f91fd9 / bc47030d4d | PORT (proven 19/20) | N/A (sequential) |
| 2 | Destructive-match guards and empty oldString | 236cfcbbc3 | PORT | PORT (worse: no similarity check) |
| 3 | FileTime stat stamp and path.resolve keys | 2cbdf04ec9 (+8bc4f91fd9) | PORT (proven) | N/A (no FileTime) |
| 4 | CRLF preservation | be9b4d1bcd | PORT (proven) | PORT (worse: whole file goes to LF) |
| 4b | Mixed endings | 0cb434775c | optional | optional |
| 5 | BOM preservation | 8113a4360e | PORT (proven) | low |
| 6 | `replaceAll` `$` patterns | none (core rewrite) | PORT (proven) | not affected |
| 7 | Restore write FileTime and Edited event | base regression | PORT | N/A |
| 8 | Non-empty success output | 66f9bdab32 | PORT | PORT |
| 9 | Patch fixes | eb4ff91c2d, 74bd52e8a7, ... | N/A (unregistered) | N/A |
