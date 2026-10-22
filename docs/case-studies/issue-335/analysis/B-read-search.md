# B: Upstream reliability fixes for read / grep / glob / ls (ripgrep)

Upstream repo: `/tmp/upstream/opencode`. Our fork: `/tmp/gh-issue-solver-1792704263647`, read only. All JS paths below are relative to `js/src/`.
Experiments are in `/tmp/upstream/analysis/experiments-B/` (Bun 1.4.3, rg 14.1.1). Each one copies the code it tests and is reproducible with `bun <file>`.

Findings are ordered by severity. "JS" means `js/src`. "Rust" means `rust/src/tool`.

---

## 1. CRITICAL: glob and ls hang forever when there are more than about 15k files. PORT (JS)

- **Upstream:** e5b33f8a5e (#10833, 2026-01-29) passes an `AbortSignal` into `Ripgrep.files`. The hang itself went away in upstream's scoped child-process rewrite: `packages/core/src/ripgrep.ts` L108-157 uses `Stream.take(limit + 1)` inside `Effect.scoped`, so rg is killed when the consumer stops (76ee87ead8, 2026-06-03). 3bda0ce123 (#39238, 2026-07-27) adds a 30 s timeout on top.
- **Bug:** `glob.ts:32-34` and `ls.ts:63` `break` after 100 results. The generator's `finally` in `file/ripgrep.ts:273-276` then runs this:
  ```ts
  } finally {
    reader.releaseLock();
    await proc.exited;
  }
  ```
  Nobody reads stdout any more, so rg blocks writing into the full pipe and `proc.exited` never resolves. There is no tool timeout and no abort wiring: `glob`/`ls` never pass `ctx.abort`, and `files()` has no signal. The tool call, and therefore the session, hangs forever. Pressing Esc does not help.
- **Proof** (`e2-files-early-break.ts`, using a copy of `files()`): with 10k files it collects 100 in 43 ms. With 20k, 50k or 150k files it prints `HANG: still waiting after 10s ... exitCode=null` (the watchdog had to kill rg). `e2b-files-early-break-fixed.ts` with the fix below collects 100 in 23 ms on 50k files. This is easy to hit with `ls`/`glob` in a home directory, a monorepo, or `**/*`.
- **Fix** (plain code, no Effect) in `file/ripgrep.ts`:
  ```ts
  export async function* files(input: { cwd: string; glob?: string[]; signal?: AbortSignal }) {
    input.signal?.throwIfAborted();
    ...
    const proc = Bun.spawn(args, { cwd: input.cwd, stdout: 'pipe', stderr: 'ignore',
                                   maxBuffer: 1024 * 1024 * 20, signal: input.signal });
    ...
    try {
      while (true) { input.signal?.throwIfAborted(); const { done, value } = await reader.read(); ... }
      if (buffer) yield buffer;
    } finally {
      await reader.cancel().catch(() => {});
      if (proc.exitCode === null) proc.kill();
      await proc.exited;
    }
    input.signal?.throwIfAborted();
  }
  ```
  Then pass `signal: ctx.abort` from `glob.ts:28` and `ls.ts:58`. `execute(params)` must become `execute(params, ctx)`.
- **Test:** create 30k empty files in a temp dir, then run `GlobTool.execute({pattern:'*'})` with a 5 s `bun:test` timeout. It currently times out. After the fix it returns 100 entries with `truncated: true`.
- **Rust:** not applicable. `glob.rs` walks in-process and has no subprocess.

## 2. HIGH: read resolves relative paths against the worktree. PORT (JS)

- **Upstream:** 6cf2c3e3db (2026-01-26) changed read to use `Instance.directory`.
- **Ours:** `tool/read.ts:39-41`
  ```ts
  if (!path.isAbsolute(filepath)) {
    filepath = path.join(Instance.worktree, filepath);
  }
  ```
  `project/project.ts:37` and `project/project.ts:72` set `worktree: '/'` for non-git directories. `glob.ts:21-23` resolves against `Instance.directory`, so the two tools disagree.
- **Proof** (`e9-read-relative-path.ts`):
  - Inside a git subdirectory (this repo, cwd `js/`), `src/tool/read.ts` resolves to `/tmp/gh-issue-solver-1792704263647/src/tool/read.ts`, which does not exist. The correct file is `.../js/src/tool/read.ts`. Worse, a name that exists at both levels, such as `package.json`, silently reads the wrong file.
  - In a non-git directory it resolves to `/src/tool/read.ts`.
- **Fix:** `filepath = path.resolve(Instance.directory, filepath);`. The title at L42 can keep using worktree.
- **Test:** `Instance.provide({directory: <git repo>/sub})`, write `sub/a.txt` and `<repo>/a.txt` with different contents, then read `a.txt`. Today it returns the root file's contents. It should return `sub`'s.
- **Rust:** not applicable. `read.rs:106` `ctx.resolve_path` joins `working_directory`.

## 3. HIGH: SVG, BMP, TIFF, ICO and AVIF are sent to the provider as image attachments. PORT (JS + Rust)

- **Upstream:** 51e310c9ce (#21114, 2026-05-01) adds `SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg","image/png","image/gif","image/webp"])`. Anything else falls through to the text/binary path. 84a0868e66 (2025-12-09) reads SVG as text.
- **Ours:** `tool/read.ts:271-297` `isImageFile` includes `.bmp/.tiff/.tif/.svg/.ico/.avif`. `read.ts:106` uses `mime = file.type`. `read.ts:114-122` attaches the data URL. `session/message-v2.ts:747-761` replays the tool attachment as a user `file` part on every later request. Nothing filters mimes further down; the only `image/...` string in the code is in a webfetch Accept header.
- **Bugs:**
  1. On image-capable models (for example Anthropic), the request now carries `image/svg+xml` or `image/x-ms-bmp`. Providers reject these media types, and because the part stays in history, every following turn of the session fails.
  2. On text-only models, `verifyImagesAtReadTool` defaults to true (`config/config.ts:137`). So `read.ts:82-87` throws `Failed to read image ... model may not be able to read images` for an `.svg`, which is plain text the model could have read.
- **Proof** (`e8-unsupported-image.ts`): `.svg -> image/svg+xml`, `.bmp -> image/x-ms-bmp`, `.tiff`, `.ico` and `.avif` all give `isImage=<fmt>` with `provider-supported=false`.
- **Fix:** in `isImageFile`, return a format only for `.jpg/.jpeg/.png/.gif/.webp`. Drop the BMP/TIFF/SVG/ICO/AVIF cases, or keep them only for `validateImageFormat`. SVG then reaches the text path. BMP, TIFF, ICO and AVIF hit `isBinaryFile` and give `Cannot read binary file` instead of poisoning the session.
- **Test:** call read on a `.svg` file with a text-only model ctx. Today it throws. After the fix the output contains `<svg`. Call read on a `.bmp`. Today it returns an attachment with a `bmp` mime. After the fix it throws `Cannot read binary file`.
- **Rust:** `read.rs:328-333` maps BMP, TIFF, SVG, ICO and AVIF mimes, so apply the same restriction in `is_image_extension`.

## 4. HIGH: grep throws away all matches when any path is unreadable (rg exit 2). PORT (JS)

- **Upstream:** 4edb4fa4fa (#8612, 2026-01-15) adds `--no-messages` and treats exit 2 as a partial result. The current form is `packages/core/src/ripgrep.ts:99-100,143-150`: exit 2 is an error only when stderr contains `regex parse error` or `error parsing regex`.
- **Ours:** `tool/grep.ts:56-66`
  ```ts
  if (exitCode === 1) { ... 'No files found' }
  if (exitCode !== 0) { throw new Error(`Exit code ${exitCode}\nripgrep failed: ${errorOutput}`); }
  ```
- **Proof** (`e1-grep-exit2.ts`): with one readable match plus a `chmod 000` directory, the result is `exitCode: 2, matchEvents: 1`, and our code throws `Exit code 2`. This is common when searching `~`, `/`, or trees containing root-owned build output.
- **Port details (important):**
  - With `--json`, stdout always contains a `summary` event, so do not copy upstream's old `!output.trim()` test.
  - With `--no-messages`, a nonexistent search path also exits 2 silently. I verified this: `rg --json --no-messages x /nonexistent` returns exit 2 with only a summary event. So add an explicit existence check, as 8f4b62eb49 (#35337) does.
  ```ts
  const searchPath = path.resolve(Instance.directory, params.path ?? '.');
  if (!(await fs.promises.stat(searchPath).catch(() => null)))
    throw new Error(`Search path does not exist: ${params.path ?? '.'}`);
  const args = ['--json', '--no-messages', '--regexp', params.pattern];
  ...
  if (exitCode === 2 && /regex parse error|error parsing regex/.test(errorOutput))
    throw new Error(`Invalid regex: ${errorOutput.trim()}`);
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2)
    throw new Error(`ripgrep failed (exit ${exitCode}): ${errorOutput}`);
  if (exitCode === 1) return 'No files found' ...;
  // exit 0 or 2: parse matches; if exit 2, append "(Some paths were inaccessible and skipped)"
  ```
  I verified that `--no-messages` still prints regex parse errors (exit 2, `rg: regex parse error: ... unclosed group`).
- **Test:** a temp dir with `ok.txt` containing `needle` plus a `chmod 000` subdirectory. Today grep `needle` throws. After the fix it returns `Found 1 matches`. Also check that `grep 'foo('` still throws a regex error, and that `path: 'missing'` still throws.
- **Rust:** not applicable. The `grep.rs:165` `if let Ok(content) = fs::read_to_string` and `grep.rs:220` `.filter_map(|e| e.ok())` already skip unreadable entries.

## 5. MEDIUM-HIGH: read output has no byte cap and `limit` has no upper bound. PORT (JS + Rust)

- **Upstream:** 1b82511fbd / c1b03b728a (#14009, 2026-02-17) add `MAX_BYTES = 50 * 1024`. Output stops at 50 KB with `(Output capped at 50 KB. Showing lines X-Y. Use offset=Y+1 to continue.)`. 683d470fe4 (#51011, 2026-09-24) clamps `limit` to at most 2000 and reports it.
- **Ours:** `tool/read.ts:13-14` (`DEFAULT_READ_LIMIT = 2000`, `MAX_LINE_LENGTH = 2000`) and `read.ts:130`: `limit` is any non-negative integer. There is no byte budget in `read.ts:141-183`, and no generic tool-output truncation either. `tool/tool.ts` only validates; the only truncation is in `bash.ts`.
- **Proof** (`e7-read-output-size.ts`, using our real `formatBalancedLineWindow`): a 1999-line minified or generated file produces **4018 KiB, about 1M tokens**, from a default `read`. That overflows the context or fails the request. An explicit `limit: 100000` is unbounded.
- **Fix:** keep the fork's head/tail summarization and column windows. In the `content` builder (L148-168), add a running byte count:
  ```ts
  const MAX_BYTES = 50 * 1024; let bytes = 0, cappedAt: number | undefined;
  for (const formatted of ...) { const size = Buffer.byteLength(formatted, 'utf8') + 1;
    if (bytes + size > MAX_BYTES) { cappedAt = lineNumber; break; } bytes += size; out.push(formatted); }
  if (cappedAt) output += `\n\n(Output capped at 50 KB. Showing lines ${first}-${cappedAt - 1}. Use offset=${cappedAt - 1} to continue.)`;
  ```
  Also apply `limit = Math.min(limit, DEFAULT_READ_LIMIT)`.
- **Test:** write 2000 lines of 5000 chars, read it, and assert `output.length < 60_000` plus the continuation hint. This fails today because the output is about 4 MB.
- **Rust:** `read.rs:135-160` has the same structure with no byte cap. Apply the same budget.

## 6. MEDIUM: read loads the whole file twice (binary sniff plus `text()`). PORT (JS + Rust)

- **Upstream:** c1b03b728a (#14009, 2026-02-17) samples 4096 bytes with `fs.open` + `fh.read`, then streams with `createReadStream` + `readline({ crlfDelay: Infinity })`. 77db212a0a (2026-05-16) stops the stream as soon as the byte cap or line limit is reached.
- **Ours:** `tool/read.ts:432` (`const buffer = await file.arrayBuffer();` to sample `bufferSize = min(4096, size)` bytes), then `read.ts:141` (`file.text().then((text) => text.split('\n'))`).
- **Proof** (`e6-read-large.ts`): a 300 MB, 3M-line log takes 1.7 s and grows the heap by 320 MiB for one read. Multi-GB logs will OOM the agent process.
- **Fix:**
  - (a) `isBinaryFile`: `const fh = await fs.promises.open(filepath,'r'); const { bytesRead } = await fh.read(buf, 0, 4096, 0); await fh.close();` and test `buf.subarray(0, bytesRead)`.
  - (b) Explicit `offset`/`limit`: stream with readline and stop after `offset + limit` lines.
  - The fork's head/tail summary for the default read needs a line count. Streaming once to count, keeping only the head lines and a ring buffer of tail lines, keeps memory at O(limit).
- **Test:** call `isBinaryFile` on a 200 MB text file and assert `process.memoryUsage().heapUsed` grows by less than 10 MB. Read a 200 MB file with `offset: 0, limit: 10` and assert it finishes in under 200 ms.
- **Rust:** `read.rs:124` `async_fs::read` (whole file) and the image path at `read.rs:309`. Use `File::open` + `take(4096)` for the sniff and `BufReader::lines()` for paging.

## 7. MEDIUM: grep cannot be aborted, has no timeout and buffers without limit. PORT (JS)

- **Upstream:**
  - 4d2696e027 adds `signal: ctx.abort` to the grep spawn.
  - 3bda0ce123 (#39238, 2026-07-27) adds a 30 s timeout: "Search timed out after 30 seconds. Consider using a more specific path or pattern."
  - b6ccb66610 (#37154) / 7affee529b (#38922) stop at `limit + 1` matches and report truncation.
- **Ours:** `tool/grep.ts:47-50` `Bun.spawn([rgPath, ...args], { stdout: 'pipe', stderr: 'pipe' })` has no signal. `grep.ts:52` buffers all of stdout, and `grep.ts:70-104` runs one `await Bun.file(filePath).stat()` per match before `slice(0, 100)` at L108-110. A broad pattern over a large tree, or over `/` (the model can pass any path), runs for minutes, holds all JSON in memory, and ignores Esc.
- **Fix:** `Bun.spawn(..., { signal: AbortSignal.any([ctx.abort, AbortSignal.timeout(30_000)]) })`. When the timeout signal fired, throw the upstream timeout message. Optionally parse stdout incrementally and `proc.kill()` after N (for example 1000) matches. Keep the fork's mtime sort over that bounded set.
- **Test:** grep `.` over a directory of 100k small files, with `ctx.abort` aborted after 100 ms. Today it resolves only after the full scan. After the fix it rejects within about 100 ms.
- **Rust:** the walker in `grep.rs:205-230` has no cancellation either, but it runs in-process. That is lower priority.

## 8. MEDIUM: macOS screenshot names (U+202F) and curly quotes are not recovered. PORT (JS + Rust)

- **Upstream:** d484f070d1 (#45807, 2026-08-30) and b47824fb63 (#50953, 2026-09-23) add `alternatePath` in `packages/core/src/tool/plugin/read.ts`.
- **Ours:** `tool/read.ts:45-67` checks only `exists()`, then does substring suggestions.
- **Proof** (`e5-read-misc.ts (b)`): for the real file `Screenshot ... 9.41.07 AM.png` with the model typing a plain space, `exists()` is false, our suggestions are `[]`, and upstream's canonical match finds the file. Pasted macOS screenshot paths always contain U+202F.
- **Fix:** before throwing not-found, run this:
  ```ts
  const canonical = (n: string) => n.normalize('NFC').replace(/[  ]/g, ' ').replace(/[‘’]/g, "'");
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const hits = entries.filter((e) => e.isFile() && canonical(e.name) === canonical(base));
  if (hits.length === 1) { filepath = path.join(dir, hits[0].name); /* continue with the normal read */ }
  ```
- **Test:** create `a b.txt`, then read `a b.txt`. Today it throws `File not found`. After the fix it returns the file's content.
- **Rust:** `read.rs:110-116`, the same addition before `find_suggestions`.

## 9. LOW-MEDIUM: grep skips hidden files while glob and ls include them. PORT (JS + Rust)

- **Upstream:** d5738f542c (#7501, 2026-01-10) and c0e71c4261 (#11415, 2026-01-30). Grep keeps `--hidden`, and the current upstream grep args are `--hidden --no-messages --glob=!**/.git/**`.
- **Ours:** `tool/grep.ts:41` is `['--json', '--regexp', params.pattern]`, while `file/ripgrep.ts:221-226` passes `--hidden` for glob/ls.
- **Proof:** `rg --json --regexp needle dir` finds 0 matches in `dir/.github/ci.yml`, and 1 match with `--hidden`. So grep cannot find content in `.github/`, `.env.example` or `.vscode/`, which glob does list.
- **Fix:** `args = ['--json', '--hidden', '--no-messages', '--glob=!.git/*', '--regexp', params.pattern]`.
- **Test:** write `.github/ci.yml` containing `needle`. grep `needle` returns `No files found` today and 1 match after the fix.
- **Rust:** `grep.rs:218` `!is_hidden(...)` has the same gap.

## 10. LOW: confusing errors for a missing parent directory or a directory path. PORT (JS), partial for Rust

- **Upstream:** 823d327401 / ff837fe949 (#33255/#33260, 2026-06-21) add typed not-found and is-a-directory/special-file errors.
- **Ours:** `tool/read.ts:50` `fs.readdirSync(dir)` is unguarded, and `read.ts:46` `Bun.file(dir).exists()` is false for directories.
- **Proof** (`e4-read-missing-and-dir.ts`):
  - `no-such-dir/a.ts` throws the raw `ENOENT: no such file or directory, scandir '.../no-such-dir'`.
  - Reading a directory throws `File not found: .../subdir`, which is wrong because it exists.
- **Fix:** `const st = await fs.promises.stat(filepath).catch(() => null); if (st?.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}. Use the ls or glob tool to list it.`);`, and guard `readdirSync` with `fs.existsSync(dir) ? ... : []`.
- **Test:** read `<tmp>/nope/a.ts` should give `File not found: <tmp>/nope/a.ts`. Read `<tmp>` should give `Path is a directory`.
- **Rust:** missing parent is already handled (`read.rs:281` `if !dir.exists()`). A directory passes `filepath.exists()` at `read.rs:110` and gives a raw EISDIR at `read.rs:124`, so add an `is_dir()` check.

## 11. LOW: CRLF and trailing newline give a wrong line count and CR in the output. PORT (JS); Rust already has it

- **Upstream:** c1b03b728a uses readline with `crlfDelay: Infinity`, which strips `\r`. 683d470fe4 adds `lineCount`: "A trailing newline ends the last line instead of starting an empty one."
- **Ours:** `tool/read.ts:141` `text.split('\n')` and `read.ts:174` `totalLines = lines.length`.
- **Proof** (`e5-read-misc.ts (c)`): `'a\r\nb\r\n'` gives `["a\r","b\r",""]` and `total 3 lines` for a 2-line file. The CR is emitted inside the model-visible text, and a phantom empty last line is numbered.
- **Fix:** `const lines = text.split(/\r?\n/); if (lines.length > 1 && lines.at(-1) === '') lines.pop();`
- **Test:** a file containing `a\r\nb\r\n` should report `total 2 lines` with no `\r` in the output.
- **Rust:** already has it. `read.rs:135` `text.lines()` strips CR and the trailing empty line, so this fix also gives JS/Rust parity.

## 12. LOW: offset past EOF returns an empty file body. PORT, optional (JS + Rust)

- **Upstream:** c1b03b728a `Offset ${offset} is out of range for this file (${lines} lines)` and 683d470fe4 (adds the line count to the message).
- **Ours:** `read.ts:142-147,174-182` emits `<file>\n\n\n(End of file - total N lines)`. The model can still recover from this, so it is low.
- **Fix:** `if (hasExplicitLineRange && offset >= lines.length && lines.length > 0) throw new Error(`Offset ${offset} is out of range for this file (${lines.length} lines)`);`

## 13. LOW: glob on a file path gives a misleading "No such file or directory". PORT (JS)

- **Upstream:** f753103e82 (#38890, 2026-07-25) `Search path is not a directory`. a06f40297b has the same shape.
- **Ours:** `file/ripgrep.ts:236-245` throws `No such file or directory: '<path>'` when cwd is an existing file.
- **Fix:** distinguish the two cases in the check: `if (!st) throw ENOENT...; if (!st.isDirectory()) throw new Error(`Search path is not a directory: ${input.cwd}`)`.

## 14. LOW: ripgrep invocation hardening. PORT, low (JS)

- **`--follow`:** c0e71c4261 (#11415) made `--follow` opt-in. Ours hard-codes it at `file/ripgrep.ts:224`, so a symlink to a large tree, such as a home directory or `/`, makes glob, ls and the system-prompt `tree()` walk it.
- **CRLF in file lists:** 5af35117db (#5948) splits with `/\r?\n/`. Ours splits on `'\n'` at `file/ripgrep.ts:264`, which leaves trailing `\r` on Windows rg output.
- **`--no-config`:** upstream's current args (`packages/core/src/ripgrep.ts`) start with `--no-config`. Ours lacks it, so a user's `RIPGREP_CONFIG_PATH` (for example `--max-columns` or `--no-hidden`) changes the tools' results.

---

## ALREADY-HAVE (no action)

| Upstream | Bug | Proof in our code |
|---|---|---|
| a06f40297b (#22356) grep exact file path | cwd set to a file broke grep on a single file | `grep.ts:45` passes the path positionally. `rg --json --regexp needle fx/ok.txt` found 1 match. |
| 5af35117db (#5948), grep part | CRLF in match lines | `grep.ts:41` uses `--json`, and `grep.ts:160-162` `stripTrailingLineEnding` uses `/\r?\n$/` |
| c64d813347 (#38631) / 7affee529b (#38922) truncation notice | results silently truncated | `glob.ts:32-35,52-57` and `grep.ts:108-110,142-147` print `(Results are truncated...)` |
| 7affee529b, empty pattern | empty regex matched everything | `grep.ts:34-36` `if (!params.pattern) throw new Error('pattern is required')` |
| b6ccb66610 (#37154) default limit | unbounded default results | `glob.ts:25`, `grep.ts:108` and `ls.ts:35` limit to 100. Rust `glob.rs` has no limit, so add one there. |
| 8f4b62eb49 (#35337) missing search path | silent empty result | grep: rg exit 2 throws with stderr (`grep.ts:64-66`). glob/ls: `file/ripgrep.ts:236-245` throws ENOENT. Keep this when porting #4 (see the note there). |
| 9918f389e7 (#23291) magic-byte mime sniff | PNG named `.jpg` sent as image/jpeg | Mostly covered: with the default `verifyImagesAtReadTool=true`, `read.ts:88-103` `validateImageFormat` rejects mismatches with a clear error. Only `LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL=false` sends the wrong mime. Optional: use the sniffed mime instead of throwing. |
| 38c641a2fc `.fbs` treated as image/video | extension-to-mime false positive | our image detection is an explicit extension list (`read.ts:271-297`) |

## NOT-APPLICABLE

- **c6977a836f, fe188f8722:** bugs in upstream's new page renderer and directory reading. We have neither.
- **60db171b44 (`.env` block):** we have no `.env` block by design (`read.ts:44` "No restrictions"). It is a policy feature, not a reliability fix.
- **2bdd279467 (#21584):** abort propagation into the inline read in prompt. Our read never consumes `ctx.abort`, and `session/prompt.ts:1367,1421` uses fresh controllers, so there is nothing to propagate until #6 or #7 are ported.
- **83dca45dd5 (#31038):** the V2 Effect runtime read rewrite. Its reliability content (media-aware, binary-safe, sampled reads) is covered by #3 and #6.
- **8113a4360e (#23797, BOM):** edit/write/apply_patch only. That belongs to report A.
- **Suspected grep deadlock from reading stdout before stderr (`grep.ts:52-53`): not a bug.** `e3-stderr-before-stdout.ts` wrote 2 MB to stderr before stdout and it completed normally, because Bun buffers both pipes.

## Rust port summary

- **Apply:** #3 (unsupported image mimes, `read.rs:328-333`), #5 (byte cap), #6 (whole-file reads at `read.rs:124,309`), #8 (U+202F recovery), #9 (hidden files at `grep.rs:218`), the #10 directory check (`read.rs:110`), #12, and a 100-result limit with a truncation notice for `glob.rs`, which is unbounded today.
- **Not needed:** #1, #2, #4, #11 and #13, because of a different architecture or the Rust code already handles them.
