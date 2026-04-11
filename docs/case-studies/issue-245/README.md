# Case Study: Issue #245 - Rust Implementation Not Fully Synced with JavaScript

## Overview

**Issue**: [#245 - Our Rust implementation is fake and not fully synced with JavaScript code](https://github.com/link-assistant/agent/issues/245)

**Reported by**: konard (Konstantin Diachenko)

**Labels**: bug

**Status**: Open

---

## Issue Description

The issue states that the Rust implementation is incomplete and not fully synchronized with the JavaScript codebase. Each file in the Rust implementation should mirror the corresponding JavaScript implementation. The full codebase tree in both languages needs to be compared, and discrepancies need to be fixed.

---

## Timeline / Sequence of Events

1. **Initial Rust implementation** started with basic tool stubs
2. **PR #241** (merged) added Rust CLI options sync (`e3e3371`)
3. **PR #244** (merged) added `--temperature` option to Rust CLI
4. **Issue #245** raised: Rust implementation remains partial compared to JS

---

## Requirements Analysis

From the issue description:
1. **Full codebase tree comparison** between JS and Rust implementations
2. **Every file should be implemented in Rust** in the same way as in JS
3. **Case study analysis** with deep root cause investigation
4. **Search online** for additional facts/data
5. **Propose solutions** for each requirement

---

## Codebase Comparison

### JavaScript Source Directory: `js/src/` (115 files)
### Rust Source Directory: `rust/src/` (16 files)

---

## Tool Comparison: JavaScript vs Rust

### Tools Implemented in Both

| Tool | JS File | Rust File | Status | Notes |
|------|---------|-----------|--------|-------|
| bash | `tool/bash.ts` | `tool/bash.rs` | Partial | JS uses tree-sitter parser; Rust uses basic exec. Both have timeout/truncation |
| read | `tool/read.ts` | `tool/read.rs` | Partial | Both support pagination, binary detection, images. Missing: image format validation details, `verifyImages` config |
| write | `tool/write.ts` | `tool/write.rs` | Good | Similar behavior |
| edit | `tool/edit.ts` | `tool/edit.rs` | Partial | JS has 9 strategies; Rust has only 4. Missing: `IndentationFlexible`, `EscapeNormalized`, `TrimmedBoundary`, `ContextAware`, `MultiOccurrence` strategies |
| glob | `tool/glob.ts` | `tool/glob.rs` | Partial | JS uses ripgrep; Rust uses `glob` crate. JS sorts by mtime |
| grep | `tool/grep.ts` | `tool/grep.rs` | Different | JS uses ripgrep directly; Rust has its own walker |
| list | `tool/ls.ts` | `tool/list.rs` | Partial | JS has tree structure output + ignore patterns; Rust lists flat |

### Tools Missing in Rust

| Tool | JS File | Priority | Complexity |
|------|---------|----------|------------|
| batch | `tool/batch.ts` | High | Medium |
| multiedit | `tool/multiedit.ts` | High | Low |
| patch | `tool/patch.ts` | High | High |
| task | `tool/task.ts` | Medium | High (session-dependent) |
| todowrite | `tool/todo.ts` | High | Low |
| todoread | `tool/todo.ts` | High | Low |
| webfetch | `tool/webfetch.ts` | High | Medium |
| websearch | `tool/websearch.ts` | High | Medium |
| codesearch | `tool/codesearch.ts` | Medium | Medium |
| invalid | `tool/invalid.ts` | Medium | Low |

---

## Root Cause Analysis

### Root Cause 1: Incremental Implementation Never Completed

The Rust implementation was started as a minimal proof-of-concept and was never fully brought up to feature parity with JavaScript. The initial commit set up the basic structure (7 tools) without a plan to systematically implement all tools.

**Evidence**:
- `cli.rs` line 660: `// For now, just output a simple response // In a full implementation, this would call the LLM API`
- Tool registry has 7 tools vs JS registry with 15 tools
- Missing entire subsystems (session management, provider integration, web tools)

### Root Cause 2: No Systematic Sync Process

There is no automated or semi-automated process to detect when JS tools are added/modified and ensure the Rust equivalent is updated. This leads to drift over time.

### Root Cause 3: Different Architecture

The JavaScript implementation relies on:
- `Instance.directory` for working directory context (global singleton)
- `Bus` event system for file events
- `Session` for state management
- `Bun` runtime APIs (file reading, HTTP, etc.)
- `Ripgrep` binary for file search

The Rust implementation has:
- `ToolContext` for per-call context (good architecture)
- No event bus implementation
- No session management
- Direct `tokio::fs` for file I/O
- Own file walker (`walkdir`)

### Root Cause 4: Edit Tool Strategy Mismatch

JS edit tool has 9 replacement strategies (SimpleReplacer, LineTrimmedReplacer, BlockAnchorReplacer, WhitespaceNormalized, IndentationFlexible, EscapeNormalized, TrimmedBoundary, ContextAware, MultiOccurrence).

Rust edit tool has only 4 (exact, line-trimmed, whitespace-normalized, block-anchor). Missing 5 strategies could cause edit failures in real-world usage.

### Root Cause 5: List Tool Output Format Mismatch

JS list tool outputs a tree structure (hierarchical directory display using ripgrep), while Rust list tool outputs a flat list. This is a significant UX difference.

---

## Impact Assessment

- **Functional Gap**: Agents using the Rust binary cannot execute web searches, fetch URLs, manage todos, run batch operations, apply patches, or search code
- **Edit Reliability**: Rust edit tool may fail on whitespace/indentation variations that JS handles gracefully  
- **Directory Navigation**: Rust list tool output format differs from JS, potentially confusing LLM agents that expect tree structure

---

## Proposed Solutions

### Solution 1: Implement All Missing Tools (Chosen)

Implement each missing tool in Rust, matching the JS API and behavior:

1. **`invalid.rs`** - Simple error tool (1-2 hours)
2. **`todo.rs`** - TodoWrite and TodoRead (in-memory state for Rust) (2-4 hours)
3. **`multiedit.rs`** - Multiple edits on a file (1-2 hours)
4. **`webfetch.rs`** - HTTP fetch + HTML-to-markdown (4-8 hours)
5. **`websearch.rs`** - Web search via Exa API (2-4 hours)
6. **`codesearch.rs`** - Code search via Exa API (2-4 hours)
7. **`batch.rs`** - Parallel tool execution (4-8 hours)
8. **`patch.rs`** - Patch application (8-16 hours)
9. **`task.rs`** - Subagent task spawning (16-24 hours, depends on session management)

### Solution 2: Sync Existing Tools

Update existing tools to match JS more closely:

1. **`edit.rs`** - Add missing 5 strategies
2. **`list.rs`** - Add ignore patterns and tree structure output
3. **`grep.rs`** - Add `include`/`type` parameters, improve output
4. **`glob.rs`** - Ensure mtime-sorted output matches JS

### Solution 3: Document Deliberate Differences

Some differences are justified by language/runtime differences:
- JS uses `Bun.sleep()`, Rust uses `tokio::time::sleep()`
- JS uses `Bus.publish()` for file events; Rust can emit events differently
- JS uses `Instance.directory` global; Rust uses `ToolContext` per-call

These should be documented so they don't appear as bugs.

---

## Implementation Plan

Priority order based on impact:

**Phase 1 (High Impact, Low/Medium Effort)**:
- `invalid.rs` - error handling
- `todo.rs` - TodoWrite/TodoRead (in-memory)
- `multiedit.rs` - delegates to edit tool
- `batch.rs` - parallel tool execution

**Phase 2 (High Impact, Medium Effort)**:
- `webfetch.rs` - HTTP + HTML-to-text/markdown
- `websearch.rs` - Exa web search API
- `codesearch.rs` - Exa code context API
- Edit strategies completion (5 missing strategies)
- List tool tree output

**Phase 3 (High Effort)**:
- `patch.rs` - full patch application
- `task.rs` - subagent spawning (requires session management)

---

## Files Analyzed

### JavaScript (complete list)
- `js/src/tool/bash.ts`
- `js/src/tool/batch.ts`
- `js/src/tool/codesearch.ts`
- `js/src/tool/edit.ts`
- `js/src/tool/glob.ts`
- `js/src/tool/grep.ts`
- `js/src/tool/invalid.ts`
- `js/src/tool/ls.ts`
- `js/src/tool/multiedit.ts`
- `js/src/tool/patch.ts`
- `js/src/tool/read.ts`
- `js/src/tool/registry.ts`
- `js/src/tool/task.ts`
- `js/src/tool/todo.ts`
- `js/src/tool/tool.ts`
- `js/src/tool/webfetch.ts`
- `js/src/tool/websearch.ts`
- `js/src/tool/write.ts`

### Rust (complete list)
- `rust/src/tool/bash.rs`
- `rust/src/tool/context.rs`
- `rust/src/tool/edit.rs`
- `rust/src/tool/glob.rs`
- `rust/src/tool/grep.rs`
- `rust/src/tool/list.rs`
- `rust/src/tool/mod.rs`
- `rust/src/tool/read.rs`
- `rust/src/tool/write.rs`
- `rust/src/util/binary.rs`
- `rust/src/util/filesystem.rs`
- `rust/src/util/mod.rs`
- `rust/src/cli.rs`
- `rust/src/error.rs`
- `rust/src/id.rs`
- `rust/src/main.rs`

---

## Conclusion

The Rust implementation needs significant work to reach feature parity with JavaScript. The most impactful areas are:
1. Missing tools (10 tools not implemented)
2. Edit tool missing 5 fallback strategies
3. List tool output format differs

These gaps mean an agent using the Rust binary cannot perform web searches, batch operations, todo management, or patch application. The edit tool has reduced reliability for whitespace-sensitive replacements.
