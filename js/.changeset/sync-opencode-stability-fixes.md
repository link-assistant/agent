---
'@link-assistant/agent': patch
---

fix: sync reliability fixes for existing tools, the session loop, providers and MCP from upstream OpenCode (#335)

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
- `read` resolves relative paths against the session directory, caps output
  at 50 KB and 2000 lines, handles CRLF files, directories and file names
  with macOS narrow no-break spaces or curly quotes, and samples only 4 KB
  for the binary check.
- `grep` keeps matches when some paths are unreadable (rg exit 2), searches
  hidden files except `.git`, honours aborts, times out after 30 s, and
  reports invalid regexes and missing paths clearly.
- `glob` and `ls` no longer hang after their 100-result limit, stop rg on
  abort, do not follow symlinked directories, and ignore a user ripgrep
  config.
- `bash` runs commands in `$SHELL` or bash instead of `/bin/sh`, keeps the
  end of long output (where errors are), never splits UTF-8 characters,
  bounds the live metadata preview, frees parser trees, and asks for
  permission for write redirects in read-only/plan modes.
- `webfetch`, `websearch` and `codesearch` enforce the 5 MB limit while
  streaming, time out with a clear message, retry Cloudflare challenges with
  an honest user agent, accept plain JSON or SSE replies from Exa, and pass
  `EXA_API_KEY` when set; `webfetch` defaults to markdown.
- Tools no longer stack a new execute wrapper on every init, and `task`
  always unsubscribes from child-session events.
- A prompt that exceeds the context window (400 "prompt is too long", 413,
  mid-stream `context_length_exceeded`) compacts the session and carries on
  instead of ending it; a second overflow stops with a clear error
  (upstream #6480, #14707).
- Tool calls reported with finish reason `stop` still get their results sent
  back to the model (upstream #14973).
- Retryable 5xx stream errors, plain-text rate limits, Vertex
  `RESOURCE_EXHAUSTED`, OpenAI item 404s and truncated gzip bodies are
  retried; retry delays never exceed the `setTimeout` limit; API errors
  include the body's message.
- A `retry-after` longer than the retry timeout now stops the turn instead of
  starting another step, and retry-only errors can be saved on a message.
- Interrupted tools keep their start time and partial output and are marked
  `interrupted`; non-object tool input is stored as `{ value }`; tool events
  that arrive without `tool-input-start` are kept.
- Lone UTF-16 surrogates, empty Anthropic/Bedrock parts and empty user
  messages are no longer sent; provider signatures and reasoning from another
  model are not replayed; prompt caching merges provider options deeply and
  uses Bedrock's cache-point format; Moonshot/Kimi tool schemas are fixed.
- Reasoning tokens are no longer charged twice, and the Anthropic thinking
  budget is kept within the model's output limit.
- MCP: connect and `tools/list` time out, list pagination is bounded,
  servers are listed in parallel, failed clients are closed and reported as
  `failed` (also for invalid URLs), servers without tools stay connected,
  results without `content` are normalized, a timed-out call is really
  aborted, per-tool timeouts work for server names with `_`, the connect
  timeout is no longer `NaN`, and dispose stops grandchild processes.
- `cancel()` rejects queued callers with an `AbortError`.
