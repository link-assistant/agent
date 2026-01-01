# Case Study: Issue #104 - JavaScript to Rust Translation

## Overview

This case study documents the lessons learned from translating the `@link-assistant/agent` CLI tool from JavaScript/TypeScript to Rust, as part of issue #104.

## Project Context

The agent CLI tool provides:

- File operations (read, write, edit)
- Directory operations (list, glob)
- Search operations (grep)
- Shell command execution (bash)
- OpenCode-compatible JSON streaming interface

## Approach

### 1. Reorganization First

Before translation, the JavaScript codebase was reorganized:

- Moved `src/` to `js/src/`
- Moved `tests/` to `js/tests/`
- Updated all configuration files (package.json, tsconfig.json, eslint.config.js)

This separation allows both implementations to coexist and be maintained independently.

### 2. Incremental Translation

Tools were translated incrementally, with tests added for each:

1. Core utilities (error handling, filesystem, binary detection)
2. Simple tools (read, write, list)
3. Complex tools (edit, grep, glob, bash)
4. CLI entry point

### 3. Test-Driven Verification

Each module included unit tests matching the behavior of the JavaScript implementation.

## Lessons Learned

### Serde Deserialization

**Issue:** JSON parameters weren't being parsed correctly for the grep tool.

**Root Cause:** The struct used `#[serde(rename_all = "camelCase")]` but the JSON API uses `snake_case` field names like `output_mode`.

**Solution:** Remove the `rename_all` attribute to use Rust's default snake_case naming, which matches the JSON API.

```rust
// Before (incorrect)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepParams { ... }

// After (correct)
#[derive(Debug, Deserialize)]
pub struct GrepParams { ... }
```

**Lesson:** Always verify the actual JSON format being received before choosing serde naming conventions.

### Hidden File Filtering with TempDir

**Issue:** Grep tests failed because temporary directories from `tempfile` crate have names like `.tmpXXXX`.

**Root Cause:** The `is_hidden()` function filtered out files/directories starting with `.`, including the temp directory root.

**Solution:** Check if the current entry is the root path before applying the hidden filter:

```rust
.filter_entry(|e| {
    // Don't filter the root path itself
    if e.path() == path {
        return true;
    }
    !is_hidden(e.file_name().to_str().unwrap_or(""))
})
```

**Lesson:** Be careful with filtering logic in directory traversal - test paths may have unexpected characteristics.

### Diff Library API Differences

**Issue:** The `similar` crate's API differed from the JavaScript `diff` library.

**Root Cause:** Expected `iter_inline_changes()` method doesn't exist; the actual method is `iter_changes()`.

**Solution:** Use `iter_changes(op)` and access changes via `change.value()`:

```rust
for op in ops.iter() {
    for change in diff.iter_changes(op) {
        match change.tag() {
            ChangeTag::Equal => output.push_str(change.value()),
            ChangeTag::Insert => output.push_str(change.value()),
            ChangeTag::Delete => { /* skip */ }
        }
    }
}
```

**Lesson:** Always consult the actual library documentation rather than assuming API similarity.

### Option Closure Signatures

**Issue:** `unwrap_or_else(|| default)` failed for `Result<T, E>` types.

**Root Cause:** `unwrap_or_else` on `Result` passes the error to the closure: `unwrap_or_else(|e| ...)`.

**Solution:** Use `|_|` to ignore the error when not needed:

```rust
// Before (compile error)
result.unwrap_or_else(|| default_value)

// After (correct)
result.unwrap_or_else(|_| default_value)
```

**Lesson:** Pay attention to closure signatures in Rust - they vary based on the type being operated on.

### Ownership and Borrowing

**Issue:** Moving a value then trying to borrow it in a conditional.

**Root Cause:** `args.working_directory` was moved into an `if let`, then borrowed later.

**Solution:** Clone the value first, or use references:

```rust
// Clone before the conditional
let cwd = args.working_directory.clone().unwrap_or_else(|| {
    std::env::current_dir().unwrap()
});
```

**Lesson:** Identify ownership transfer points early and decide on cloning vs borrowing strategy.

## Architecture Decisions

### Async Runtime

Chose `tokio` for the async runtime due to:

- Wide ecosystem support
- Required for async command execution
- Good integration with other async crates

### Error Handling

Created a custom `AgentError` enum with:

- Clear error variants (ToolExecution, InvalidArguments, FileNotFound, etc.)
- JSON serialization for API compatibility
- Helpful context in error messages

### Tool Trait Pattern

Used an async trait pattern:

```rust
#[async_trait]
pub trait Tool: Send + Sync {
    fn id(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn parameters_schema(&self) -> Value;
    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult>;
}
```

This mirrors the JavaScript implementation's interface while being idiomatic Rust.

## Testing Strategy

1. **Unit tests per module** - Each tool has its own test module
2. **Temp directories** - Using `tempfile` crate for isolated file system tests
3. **Async test runtime** - Using `#[tokio::test]` for async test functions

## Dependencies

Key crates used:

- `clap` - CLI argument parsing
- `tokio` - Async runtime
- `serde` / `serde_json` - JSON serialization
- `similar` - Diff generation
- `walkdir` - Directory traversal
- `regex` - Pattern matching
- `glob` - File globbing
- `async-trait` - Async trait support

## Metrics

- **Lines of Rust code:** ~1,500
- **Test count:** 52 tests
- **Tools implemented:** 7 (read, write, edit, list, glob, grep, bash)

## Future Improvements

1. Add proper error context propagation using `anyhow` or `thiserror`
2. Implement remaining tools from the JavaScript version
3. Add integration tests that test the full CLI flow
4. Consider adding property-based testing with `proptest`
5. Profile and optimize hot paths once functionality is complete
