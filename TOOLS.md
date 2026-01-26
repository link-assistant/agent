# Supported Tools

This document lists all tools supported by `@link-assistant/agent`. All tools are enabled by default and produce OpenCode-compatible JSON output.

> ⚠️ **Bun-only** - This package requires [Bun](https://bun.sh) and does NOT support Node.js or Deno.

## File Operations

### read

Reads file contents from the filesystem.

**Status:** ✅ Fully supported and tested
**Test:** [tests/read.tools.test.js](tests/read.tools.test.js)

### write

Writes content to files in the filesystem.

**Status:** ✅ Fully supported and tested
**Test:** [tests/write.tools.test.js](tests/write.tools.test.js)

### edit

Performs exact string replacements in files.

**Status:** ✅ Fully supported and tested
**Test:** [tests/edit.tools.test.js](tests/edit.tools.test.js)

### list (ls)

Lists files and directories.

**Status:** ✅ Fully supported and tested
**Test:** [tests/list.tools.test.js](tests/list.tools.test.js)

## Search Tools

### glob

Fast file pattern matching tool that works with any codebase size. Supports glob patterns like `**/*.js` or `src/**/*.ts`.

**Status:** ✅ Fully supported and tested
**Test:** [tests/glob.tools.test.js](tests/glob.tools.test.js)

### grep

Powerful search tool built on ripgrep. Supports full regex syntax and can filter by file type or glob pattern.

**Status:** ✅ Fully supported and tested
**Test:** [tests/grep.tools.test.js](tests/grep.tools.test.js)

### websearch

Searches the web using Exa API for current information. Always enabled, no environment variables required.

**Status:** ✅ Fully supported and tested
**Test:** [tests/websearch.tools.test.js](tests/websearch.tools.test.js)
**OpenCode Compatibility:** ✅ 100% compatible

### codesearch

Searches code repositories and documentation using Exa API. Always enabled.

**Status:** ✅ Fully supported and tested
**Test:** [tests/codesearch.tools.test.js](tests/codesearch.tools.test.js)
**OpenCode Compatibility:** ✅ 100% compatible

## Execution Tools

### bash

Executes bash commands in a persistent shell session with optional timeout.

**Status:** ✅ Fully supported and tested
**Test:** [tests/bash.tools.test.js](tests/bash.tools.test.js)

### batch

Batches multiple tool calls together for optimal performance. Executes multiple tools in a single operation. Always enabled.

**Status:** ✅ Fully supported and tested
**Test:** [tests/batch.tools.test.js](tests/batch.tools.test.js)

### task

Launches specialized agents to handle complex, multi-step tasks autonomously.

**Status:** ✅ Fully supported and tested
**Test:** [tests/task.tools.test.js](tests/task.tools.test.js)

## Utility Tools

### todo (todowrite/todoread)

Reads and writes TODO items for task tracking during execution.

**Status:** ✅ Fully supported and tested
**Test:** [tests/todo.tools.test.js](tests/todo.tools.test.js)

### webfetch

Fetches content from a specified URL and processes it using an AI model.

**Status:** ✅ Fully supported and tested
**Test:** [tests/webfetch.tools.test.js](tests/webfetch.tools.test.js)

## Testing

### Run All Tool Tests

```bash
bun test tests/*.tools.test.js
```

### Run Specific Tool Test

```bash
bun test tests/bash.tools.test.js
bun test tests/websearch.tools.test.js
```

### Test Coverage

Each tool test verifies:

- ✅ Correct JSON output structure
- ✅ OpenCode compatibility (where applicable)
- ✅ Proper input/output handling
- ✅ Error handling

## Key Features

### No Configuration Required

- All tools work without environment variables or configuration files
- WebSearch and CodeSearch work without `OPENCODE_EXPERIMENTAL_EXA`
- Batch tool is always enabled, no experimental flag needed

### OpenCode Compatible

- All tools produce JSON output compatible with OpenCode's format
- WebSearch and CodeSearch tools are 100% compatible with OpenCode output
- Tool event structure matches OpenCode specifications

### Plain Text Input Support

`@link-assistant/agent` also accepts plain text input (not just JSON):

```bash
echo "hello world" | agent
```

Plain text is automatically converted to a message request.
