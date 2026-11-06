# C: Upstream shell/web/task/batch/todo/invalid/registry reliability fixes vs our fork

Scope: anomalyco/opencode fixes made after the fork base 0068cb305f (2025-11-19). Only fixes that make tools we already have more reliable are considered.

- Fork: /tmp/gh-issue-solver-1792704263647/js/src/tool/*. Nothing in the fork was edited.
- Experiments: /tmp/upstream/analysis/experiments-C/. Run them from /tmp/gh-issue-solver-1792704263647/js with `bun <file>`.

Findings are ordered by severity.

---

## PORT

### 1. [HIGH, security] In plan/readonly mode the bash permission scan ignores output redirects, so `echo x > file` writes files

- **Upstream:** e7ff7143b6, PR #6737, 2026-01-30, "handle redirected_statement treesitter node in bash permissions".
  - Upstream fix: the permission pattern becomes `node.parent?.type === "redirected_statement" ? node.parent.text : node.text`, so the redirect is part of the text that is matched.
  - Upstream has no readonly mode, so with `echo*` it would still allow the command. **Our version needs a stronger, adapted fix.**
- **Our bug:**
  - js/src/tool/bash.ts:104-122 builds tokens only from `command` children of type command_name/word/string/raw_string/concatenation. A `file_redirect` is a sibling under `redirected_statement`, so it is dropped.
  - `echo hi > x.txt` therefore yields `['echo','hi']`, which matches `'echo*': 'allow'` (js/src/permission/index.ts:69, readonlyBash).
  - Our own string evaluator already guards this case (js/src/permission/index.ts:219-225, `hasRedirection = />>?/`), but the bash tool calls `checkBashTokens` (index.ts:520-560), not `evaluateBash`.
- **Proof:** experiments-C/bash-redirect-readonly.ts, run with permissionMode=readonly:
  ```
  string evaluator (evaluateBash) on same command: deny
  BLOCKED : rm -f nothing
  ALLOWED : echo pwned > written.txt
  ALLOWED : cat /etc/hostname >> appended.txt
  files written in readonly mode: [ "written.txt", "appended.txt" ]
  ```
- **Logic to apply** (adapted; verified in experiments-C/redirect-detect.ts):
  ```ts
  const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);
  function writeRedirects(root): string[] {
    const hits = [];
    for (const r of root.descendantsOfType('file_redirect')) {
      if (!r) continue;
      let op = '';
      for (let i = 0; i < r.childCount; i++) { const c = r.child(i); if (c && WRITE_OPS.has(c.type)) op = c.type; }
      const dest = r.childForFieldName('destination')?.text ?? r.lastChild?.text ?? '';
      if (!op || dest === '/dev/null') continue;
      if (op === '>&' && /^\d+$|^-$/.test(dest)) continue;   // 2>&1
      hits.push(r.text);
    }
    return hits;
  }
  ```
  Results from the experiment:

  | Command | Flagged? |
  |---|---|
  | `> x.txt`, `>> b`, `{ echo a; } > f`, `&> log`, `>| f` | yes |
  | `2>/dev/null`, `2>&1`, `< in.txt`, heredoc | no |
- **How to apply:**
  - In bash.ts, right after the tree is built (l.99-102), call `writeRedirects(tree.rootNode)`.
  - If it returns anything, make it resolve to the policy's catch-all action. For example, push one extra entry into `commands` that only `'*'` matches, such as `['>', ...hits]`.
  - Alternatively, add a `redirects: string[]` input to `checkBashTokens` that is evaluated as `patterns['*']`, raising a deny or adding an ask pattern.
- **Failing test:** set `config.permissionMode = 'readonly'` and run BashTool with `echo pwned > f.txt`. Expect a rejection and no f.txt. Today it is allowed and the file is created.
- **Rust:** rust/src/tool/bash.rs has no permission scan. N/A.

### 2. [HIGH] The "bash" tool actually runs /bin/sh, which is dash on Debian/Ubuntu, so bash syntax fails

- **Upstream:**
  - b5d0c56b4c, PR #3494, 2025-11-22: respect $SHELL.
  - 238b907dd8, PR #5205, 2025-12-07: match on basename, and reject fish/nu.
  - 27ae341684, 2025-11-23: win32/WSL.
  - Latest form is packages/core/src/shell/select.ts: `META` deny table plus `fallback()`.
- **Our bug:** js/src/tool/bash.ts:162-174 uses `new ProcessRunner({ mode: 'shell', file: params.command, args: [] })`. command-stream spawns that with Node `shell: true`, which is `/bin/sh -c`.
- **Proof:** experiments-C/bash-behaviour.ts (1):
  ```
  "Exit code 127\nsh\n{1..3}\n/bin/sh: 1: [[: not found\n"      (/bin/sh -> dash)
  ```
- **Upstream logic** (Effect stripped):
  ```ts
  function selectShell() {
    if (process.platform === 'win32') return undefined;           // keep current path on Windows
    const s = process.env.SHELL;
    if (s && !['fish', 'nu'].includes(path.basename(s).toLowerCase()) && Bun.which(s)) return s;
    if (process.platform === 'darwin') return '/bin/zsh';
    return Bun.which('bash') ?? '/bin/sh';
  }
  ```
- **How to apply:**
  - Resolve the shell once with `lazy(selectShell)`.
  - On non-win32, build the runner as `new ProcessRunner({ mode: 'exec', file: shell, args: ['-c', params.command] }, { ...same options })`.
  - Keep the current `mode: 'shell'` spec on win32, where the taskkill path already exists.
  - Verified in experiments-C/shell-exec-mode.ts:
    - exec mode runs `echo {1..3}; [[ ]]` under /usr/bin/bash → `"1 2 3\nbashism-ok\n"`.
    - A timeout still kills the whole process group: the grandchild did not survive.
  - Re-run the existing bash tests for the `command.result.child.signalCode` path (bash.ts:200-203).
- **Failing test:** run the command `[[ 1 == 1 ]] && echo ok`. Expect `ok`. Today it gives exit 127 on any dash-based distro.
- **Rust:** bash.rs:176 hardcodes `Command::new("bash")`, so it already uses bash. $SHELL support is optional; no bug.

### 3. [HIGH] Bash output: unbounded memory, O(n^2) metadata, head truncation drops the error tail, and split UTF-8

- **Upstream:**
  - 307251bf3c, PR #22660, 2026-04-15, "bash memory usage".
  - 754ea99d86, PR #39403, 2026-07-28, "preserve shell output tail".
  - 2092350cfa, PR #41007, 2026-08-07, "align shell output limits".
  - Streaming text decode: the snapshot shell.ts uses `Stream.decodeText`.
- **Our bugs:**
  - bash.ts:185 `output += chunk.data.toString()`: the whole output is kept in memory, and the full string is sent to `ctx.metadata` on every chunk (l.186-191). Each call is a `Session.updatePart` storage write plus a Bus publish.
  - bash.ts:214-216 `output.slice(0, MAX_OUTPUT_LENGTH)` keeps the head and drops the tail, which is where compiler and test errors appear.
  - bash.ts:185 also decodes each Buffer chunk on its own, so a multi-byte character split across chunks becomes two U+FFFD.
- **Proof** (experiments-C/bash-behaviour.ts and bash-utf8-split.ts):
  - (2) For 100 KB of output ending in FINAL-ERROR-LINE: `tail kept? false head kept? true`.
  - (3) For 4 MB of output: 47 metadata calls carrying 71,489,792 chars in total, with RSS +21.7 MB. The tool output itself is only 30 KB.
  - bash-utf8-split.ts: 3 euro signs split across chunks gave `intact: 0 replacement chars: 6`.
- **Upstream logic** (from /tmp/upstream/last/packages/opencode/src/tool/shell.ts:220-253 and 436-500, Effect and truncation-file stripped):
  ```ts
  const MAX_METADATA_LENGTH = 30_000;
  function preview(text: string) {
    if (text.length <= MAX_METADATA_LENGTH) return text;
    return '...\n\n' + text.slice(-MAX_METADATA_LENGTH);
  }
  function tail(text: string, maxLines: number, maxBytes: number) {
    const lines = text.split('\n');
    if (lines.length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes) return { text, cut: false };
    const out: string[] = []; let bytes = 0;
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i], 'utf-8') + (out.length > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        if (out.length === 0) {
          const buf = Buffer.from(lines[i], 'utf-8');
          let start = Math.max(0, buf.length - maxBytes);
          while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
          out.unshift(buf.subarray(start).toString('utf-8'));
        }
        break;
      }
      out.unshift(lines[i]); bytes += size;
    }
    return { text: out.join('\n'), cut: true };
  }
  // streaming loop
  const keep = MAX_BYTES * 2; const list: { text: string; size: number }[] = [];
  let used = 0, cut = false, last = '';
  const decoder = new TextDecoder();
  for await (const chunk of command.stream()) {
    if (chunk.type === 'exit') { exit = chunk.code; continue; }
    const text = decoder.decode(chunk.data, { stream: true });
    const size = Buffer.byteLength(text, 'utf-8');
    list.push({ text, size }); used += size;
    while (used > keep && list.length > 1) { used -= list.shift()!.size; cut = true; }
    last = preview(last + text);
    ctx.metadata({ metadata: { output: last, description: params.description } });
  }
  const end = tail(list.map((i) => i.text).join(''), MAX_LINES, MAX_BYTES);
  output = (cut || end.cut ? '...output truncated...\n\n' : '') + end.text;
  ```
- **How to apply:**
  - Replace bash.ts:135 and :181-193 with the loop above.
  - Replace bash.ts:214-217 with the `tail()` result. Use MAX_BYTES = 30_000, which keeps the current documented limit; upstream uses 50 KB and 2000 lines.
  - Keep the timeout and abort notices appended after the output (l.219-225). Metadata `output` at l.247 should be `last`.
  - Optionally throttle `ctx.metadata`, for example once every 100 ms. Upstream does not do this, but each call is a full storage write.
  - Update bash.txt:23 to "the beginning of the output is dropped".
- **Failing tests:**
  - (a) `printf start; head -c 100000 /dev/zero | tr '\0' x; echo FINAL; exit 3`: expect the output to contain `FINAL`.
  - (b) Record every `ctx.metadata` payload: expect each payload to be at most 30_006 chars.
  - (c) `printf '\342\202'; sleep 0.2; printf '\254'`: expect `€`.
- **Rust:** bash.rs:125-127 needs the same tail-keeping truncation. It also has a **crash** at that spot:
  - `output.truncate(MAX_OUTPUT_LENGTH)` panics when byte 30000 is not on a char boundary.
  - Proof: experiments-C/rust/truncate_panic.rs → `assertion failed: self.is_char_boundary(new_len)`.
  - Fix: port `tail()` with the same UTF-8 continuation-byte skip, or truncate at `floor_char_boundary`.

### 4. [MEDIUM] Tool.define re-wraps `execute` on every init() for object-defined tools

- **Upstream:** 81d3ac3bf0, PR #16952, 2026-04-02.
- **Our bug:**
  - js/src/tool/tool.ts:90 `const toolInfo = init instanceof Function ? await init() : init;`.
  - l.91-107 then replace `toolInfo.execute` on the shared object, so each init adds one more wrapper and one more `parameters.parse`.
  - `ToolRegistry.tools()` calls `init()` for every tool on every agent step (js/src/tool/registry.ts:100-109), and batch does the same per batch.
  - Every built-in is defined as an object: bash, webfetch, websearch, codesearch, batch, todo, invalid and others.
- **Proof:** experiments-C/define-accumulation.ts: after 101 init() calls, a single execute performs 101 `parse()` calls. Cost grows linearly in CPU and closure memory over a long session. It does not overflow at 200k, because of tail calls.
- **Upstream logic:** `const toolInfo = init instanceof Function ? await init() : { ...init };`
- **How to apply:** make that one-line change at tool.ts:90.
- **Failing test:** call `init()` 5 times on a tool with a spied `parameters.parse`, then execute once. Expect 1 parse call; today there are 5.
- **Rust:** mod.rs has no such wrapper. N/A.

### 5. [MEDIUM] webfetch timeout: the timer leaks when fetch rejects, and the body read is not covered

- **Upstream:**
  - bc1840b196, PR #21378, 2026-04-07: try/finally clears the timer.
  - The upstream core version (69f1ec22e3, PR #33259, 2026-06-21) runs the body read under the request timeout.
- **Our bugs:**
  - js/src/tool/webfetch.ts:53-54 arms the timer, and l.76-86 runs `await verboseFetch(...)` and then `clearTimeout`. If the fetch rejects (DNS failure, ECONNREFUSED, TLS), the timer stays pending for up to 120 s and keeps a one-shot CLI process alive.
  - The timer is also cleared before `arrayBuffer()` (l.98), so a server that sends headers and then trickles the body is never timed out.
- **Proof:**
  - experiments-C/webfetch-timer-leak.ts: `fetch failed after ms 8` but `process exit after ms 8007`.
  - experiments-C/webfetch-behaviour.ts (4): with `timeout: 1` and a body trickling for 3 s, it returned success after `ms: 3280`.
- **Upstream logic:**
  ```ts
  const response = await (async () => {
    try { return await fetch(url, { signal, headers }); }
    finally { clearTimeout(timeoutId); }
  })();
  ```
- **How to apply:**
  - Clear the timer in a `finally` that wraps both the fetch **and** the body read (l.76-101), not right after headers arrive.
  - Simplest is `const signal = AbortSignal.any([AbortSignal.timeout(timeout), ctx.abort])` with no manual timer at all. `AbortSignal.timeout` does not keep the process alive, and its abort also cancels the body stream.
- **Failing tests:**
  - (a) Fetch `http://127.0.0.1:9/` with timeout 8 in a child process: expect the process to exit in under 1 s.
  - (b) A local server that trickles the body for 3 s, with `timeout: 1`: expect a "timed out" error.
- **websearch.ts:89-114 and codesearch.ts:71-96** use the same pattern, but they clear the timer in both try and catch, so there is no leak. The body read (`response.text()`, websearch.ts:114, codesearch.ts:96) is still outside the timeout. Apply the same `AbortSignal.timeout` change there.
- **Rust:** reqwest's `ClientBuilder::timeout` (webfetch.rs:107) covers the body and has no timer to leak. N/A.

### 6. [MEDIUM] webfetch `format` is required, so models that omit it fail validation

- **Upstream:**
  - fd973d242e, PR #6345, 2025-12-29: `.default('markdown')`.
  - 2d2f587bfa, PR #30215, 2026-06-01: do not make the schema nullable.
- **Our bug:** js/src/tool/webfetch.ts:18-22 has `format: z.enum([...])` with no default.
- **Proof:** experiments-C/webfetch-behaviour.ts (1): `{url}` without format → `Error: The webfetch tool was called with invalid arguments: ... invalid_value`.
- **Caveat for the port (verified):** a plain `.default('markdown')` is **not enough** in our fork, for two reasons:
  - js/session/prompt.ts:1167 sends `z.toJSONSchema(item.parameters)`, whose default output mode still lists `format` as `required`. Experiment (6): `required with .default(): ["format"]`.
  - tool.ts:94-106 validates the arguments but passes the **raw** `args` to execute, so a default never reaches `params.format`. An undefined format falls into `default:` (webfetch.ts:147) and returns raw HTML.
- **How to apply:**
  - Use `format: z.enum(['text','markdown','html']).optional().describe('... Defaults to markdown.')`.
  - Add `const format = params.format ?? 'markdown';` at the top of execute, and use `format` in both switches (l.58, l.109).
  - Update webfetch.txt to the upstream wording.
  - Optionally, have tool.ts pass the parsed value (`return execute(toolInfo.parameters.parse(args), ctx)`) so zod defaults work everywhere.
- **Failing test:** execute `{ url }` against a local text/html server. Expect markdown output; today it is a validation error.
- **Rust:** webfetch.rs:37-38 `pub format: String` (no `#[serde(default)]`) and :75 `"required": ["url","format"]`. Same fix applies: use `#[serde(default = "markdown")]` and drop format from `required`.

### 7. [MEDIUM] web tool bodies are buffered without a bound

- **Upstream:** 69f1ec22e3, PR #33259, 2026-06-21, "bound web tool failures". It adds `collectBoundedResponseBody` (packages/core/src/tool/http-body.ts), used by webfetch and websearch. The same commit also maps a converter throw to an error result.
- **Our bug:**
  - webfetch.ts:93-101 checks `content-length` and then `await response.arrayBuffer()`, so a chunked or lying response is buffered in full before the 5 MB check.
  - websearch.ts:114 and codesearch.ts:96 call `response.text()` with no cap at all.
- **Proof:** experiments-C/webfetch-behaviour.ts (5): a 20 MB chunked body gave `Response too large`, but the server had sent all `20` MB first. An endless body would grow until OOM.
- **Upstream logic** (Effect stripped):
  ```ts
  async function readBounded(res: Response, max: number, tooLarge: () => Error) {
    const n = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    if (Number.isSafeInteger(n) && n > max) throw tooLarge();
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  }
  ```
- **How to apply:**
  - Replace webfetch.ts:93-101 with `const arrayBuffer = await readBounded(response, MAX_RESPONSE_SIZE, () => new Error('Response too large (exceeds 5MB limit)'))`.
  - In websearch/codesearch, use `readBounded(response, 5MB, ...)` and then `.toString('utf8')`.
- **Failing test:** a server streams 20 x 1 MB chunks with no content-length. Expect an error after at most 6 chunks have been pulled; today all 20 are pulled.
- **Rust:** webfetch.rs:150-153 `response.bytes().await` has the same problem. Use `response.chunk()` in a loop with a cap. websearch.rs:186 and codesearch.rs have the same issue.

### 8. [MEDIUM-LOW] Parsed tree-sitter trees are never deleted (WASM heap leak)

- **Upstream:** d4bf70be06, PR #24861, 2026-04-29.
- **Our bug:** js/src/tool/bash.ts:99 `const tree = await parser().then((p) => p.parse(params.command));` has no `tree.delete()`. web-tree-sitter trees live in the WASM heap and are not garbage-collected. This only matters when `Permission.bashEnforced()` is true, that is plan/readonly/ask modes or a `--permission` override.
- **Upstream logic:** `acquireRelease(parse(...), tree => tree.delete())`. In plain TS: `try { ...scan tree.rootNode, await checkBashTokens(...) } finally { tree.delete(); }`.
- **How to apply:** wrap bash.ts:103-129 in try/finally after the `!tree` check. Better, delete the tree before `checkBashTokens`, which can wait on a permission ask: collect `commands`, then call `tree.delete()`, then check.
- **Failing test:** in readonly mode, parse 10,000 commands through BashTool with `echo` and watch the WASM memory. A cheaper check is to spy that `Tree.prototype.delete` is called once per execute.
- **Rust:** N/A.

### 9. [LOW] webfetch has no Cloudflare 403 retry and an outdated UA

- **Upstream:**
  - b978ca11da, PR #10328, 2026-01-24.
  - 774c24e76e, PR #8284, 2026-01-13: Chrome/120 → Chrome/143.
- **Our bug:**
  - webfetch.ts:88-90 throws on any 403.
  - webfetch.ts:80 sends a Chrome/120 UA. Cloudflare challenges a spoofed Chrome UA whose TLS fingerprint does not match, and an honest UA passes.
- **Proof:** experiments-C/webfetch-behaviour.ts (3): a `403 + cf-mitigated: challenge` server gave `Request failed with status code: 403` and the server saw 1 call.
- **Upstream logic:**
  ```ts
  const initial = await fetch(url, { signal, headers });
  const response = initial.status === 403 && initial.headers.get('cf-mitigated') === 'challenge'
    ? await fetch(url, { signal, headers: { ...headers, 'User-Agent': 'opencode' } })
    : initial;
  ```
- **How to apply:**
  - Hoist the headers object (l.78-83) and add the retry inside the try/finally from finding 5.
  - The honest UA can be the branded agent name.
  - Bump the UA to `Chrome/143.0.0.0`.
- **Failing test:** the same server should return "real page" after 2 calls.
- **Rust:** webfetch.rs:108 (UA) and :125-131 (no retry). Same fix applies.

### 10. [LOW] webfetch `format: 'text'` drops text that follows a `<script>`/`<style>` element

- **Upstream:** ad6a8a1850, PR #26309, 2026-05-13. The swap to htmlparser2 is for Node compat and is N/A to us. The `skipDepth` counter logic is the fix.
- **Our bug:** js/src/tool/webfetch.ts:157-196. `skipContent` is set to true when a script opens and is reset only when another element opens. Text after `</script>` up to the next tag is lost, and so is text outside any element.
- **Proof:** experiments-C/webfetch-behaviour.ts (2): `<p>Hello <script>x()</script> world</p><p>tail</p>` → `"Hello tail"`, so " world" is lost.
- **Logic for us** (HTMLRewriter has no htmlparser2 in our deps; verified in experiments-C/html-text-skipdepth.ts, giving `"Hello  worldtail"`, `"ab"`, `"prepost"`, `"visible"`):
  ```ts
  let text = '', skipDepth = 0;
  await new HTMLRewriter()
    .on('script, style, noscript, iframe, object, embed', {
      element(el) { if (!el.canHaveContent) return; skipDepth++; el.onEndTag(() => { skipDepth--; }); },
    })
    .onDocument({ text(t) { if (skipDepth === 0) text += t.text; } })
    .transform(new Response(html)).text();
  return text.trim();
  ```
- **How to apply:** replace the body of `extractTextFromHTML` (l.157-196) with the code above.
- **Failing test:** the input above should contain "world".
- **Rust:** `extract_text_from_html` resets on the closing tag (webfetch.rs about l.215-230), so it is already correct. N/A.

### 11. [LOW] TaskTool leaks its PartUpdated Bus subscription when the subagent prompt throws

- **Upstream:** 63f5669eb5, PR #9992, 2026-01-28: `.finally(() => unsub())`.
- **Our bug:**
  - js/src/tool/task.ts:85 subscribes, and l.130 calls `unsub()` only after `SessionPrompt.prompt` (l.114) returns.
  - If `resolvePromptParts` (l.113) or `prompt` throws, for example on a provider error or cancel, the subscription stays registered for the life of the instance.
- **How to apply:** wrap l.113-129 in `try { ... } finally { unsub(); }`, or register `using _unsub = defer(unsub)` right after l.85. `defer` is already imported (l.11).
- **Failing test:** mock `SessionPrompt.prompt` to reject. Expect the Bus subscriber count for `PartUpdated` to be unchanged after the tool throws.
- **Rust:** N/A, since task.rs was not in scope.

### 12. [LOW, optional] websearch: EXA_API_KEY and current-year hint

- **EXA_API_KEY:** fde3d9133b, PR #16362, 2026-04-17. The anonymous Exa MCP endpoint is rate-limited.
  - Upstream: `const URL = process.env.EXA_API_KEY ? \`https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}\` : 'https://mcp.exa.ai/mcp'`.
  - Ours: websearch.ts:10 and codesearch.ts:9 always use the anonymous endpoint.
  - This is an opt-in env var that reduces 429 failures.
  - Rust: websearch.rs:13 and codesearch.rs:13, same change.
- **Current-year hint:** 1a43e5fe87 (2026-01-15) and 179c40749d (PR #13559, 2026-02-13). The description gets "The current year is {{year}}. You MUST use this year when searching...", using `{{year}}` rather than the date so the prompt cache still hits.
  - Ours: websearch.txt has no date.
  - This improves search accuracy rather than tool stability; port it only if wanted.
- **Exa JSON responses:** upstream `parseResponse` also accepts a plain JSON body, not just `data:` SSE lines. This came from feature commit a43d3e0e1e. Ours (websearch.ts:117-133) returns "No search results found" if Exa answers with `application/json`. Only worth porting if that is observed.

---

## ALREADY-HAVE

| Upstream | Fix | Proof in fork |
|---|---|---|
| e22c1622e0, PR #51145, 2026-09-24 | report signal kills | bash.ts:200-203 (`signalCode`), process-result.ts:11-14 (`Exit code unavailable (signal X)`). Experiment (5): `kill -9 $$` → `"Exit code unavailable (signal SIGKILL)"`. **Rust lacks it**: bash.rs:194 `status.code().unwrap_or(-1)` reports "Exit code -1". |
| 210be4b749, PR #39559, 2026-07-29 | keep output on timeout | bash.ts:219-221 appends the notice to the partial output. Experiment (4): `"...before timeout\n\n(Command timed out after 300 ms)"`. **Rust lacks it**: bash.rs:148-151 discards all output on timeout. |
| 36f5ba52e9, PR #9517 | batch description matches limit | batch.txt:9 "1–10" matches batch.ts:39 `slice(0, 10)`. The upstream raise to 25 (673e79f457) is a tweak, not a fix. |
| 751899eeec, PR #5676; 38014fe448, PR #20771 | no unsupported params or dynamic parts in bash.txt | bash.txt has no `run_in_background`, `workdir`, `${os}` or `${directory}`. |
| c228fc4886, PR #38590 | stable tool order | registry.ts:76-93 returns a fixed array. |

## NOT-APPLICABLE

- **330ef108ce (PR #40542), missing workdir:** we have no `workdir` parameter.
- **76186d19f3:** external_directory permission, which we don't have.
- **e26abd8da9 (PR #27517), closing the truncation file stream:** we have no truncation file. It becomes relevant only if file spill is ported later.
- **4ab35d2c5c:** Electron `windowsHide`.
- **ad1a4a6539 (PR #50676):** core notice wording only.
- **59790380de (2026-07-06), unlimited shell timeouts:** a feature (API/schema change), not a fix.
- **ba417d80b1 (2025-12-05):** timeout+100 ms and metadata capped at the limit. Superseded by finding 3.
- **93e060272a (PR #12024), abortAfter() using bind to avoid closure retention:** the retention only lasts while the timer is pending. Once finding 5 is applied (or `AbortSignal.timeout` is used) no timer outlives the call.
- **75d141b574 (PR #25798), cancel child session on fiber interrupt:** Effect-interrupt specific. Our TaskTool cancels through the ctx.abort listener (task.ts:108-112).
- **Plugin/core registry and runtime hardening:** 8b6a2450d5 (#45325), f928b5be07 (#34512), c79a9634d3 (#28357), 33e3d1ebca (#39130), 244ec6c8f7 (#44789), 2970b7a6a8 (#43576). All concern plugin or JSON-schema tool registration. Our `ToolRegistry.register` (registry.ts:62-70) has no callers; only built-in zod tools exist. MCP tool names are already sanitized (mcp/index.ts:360-361).
- **3bda0ce123 (PR #39238):** glob/grep bounds. Covered by the read/glob/grep report.
- **6aa8e894b1 / 2481dde36d:** upstream removed codesearch as "broken". Informational only; our CodeSearchTool still points at the Exa endpoint.
- **invalid.ts / todo.ts:** no upstream post-fork reliability fixes.

## Rust-only issues found while checking (no upstream counterpart)

- **rust/src/tool/bash.rs:176-197 deadlocks** when a command writes more than about 64 KiB to stderr before closing stdout. It reads stdout to EOF first, and only then reads stderr. It hangs until the 120 s timeout.
  - Proof: experiments-C/rust/pipe_deadlock.rs (std mirror) → `exit=124` under `timeout 5`.
  - Fix: read both pipes concurrently (`tokio::join!`) or merge them.
- **bash.rs:125-127:** `String::truncate` panic on a non-char boundary (see finding 3).

## Experiment index (/tmp/upstream/analysis/experiments-C/)

- bash-behaviour.ts: shell is dash; head truncation; metadata volume; timeout and signal (already have).
- bash-redirect-readonly.ts: readonly redirect write bypass.
- redirect-detect.ts: proposed redirect detector.
- shell-exec-mode.ts: exec-mode bash with group kill.
- bash-utf8-split.ts: U+FFFD from per-chunk decoding.
- define-accumulation.ts: Tool.define wrapper growth.
- webfetch-behaviour.ts: format omitted; script-tail drop; CF 403; trickle body past timeout; 20 MB chunked body; JSON-schema `required` with `.default()`.
- webfetch-timer-leak.ts: pending timer keeps the process alive.
- html-text-skipdepth.ts: proposed HTMLRewriter text extractor.
- rust/truncate_panic.rs, rust/pipe_deadlock.rs.
