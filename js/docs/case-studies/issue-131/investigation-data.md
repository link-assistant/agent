# Investigation Data for Issue #131

## Code Snippets

### Logging Initialization (Before Fix)

```javascript
await Log.init({
  print: Flag.OPENCODE_VERBOSE, // Only prints when verbose
  level: Flag.OPENCODE_VERBOSE ? 'DEBUG' : 'INFO',
  compactJson: argv['compact-json'] === true,
});
```

### Logging Initialization (After Fix)

```javascript
await Log.init({
  print: true, // Always print logs to stdout
  level: Flag.OPENCODE_VERBOSE ? 'DEBUG' : 'INFO',
  compactJson: argv['compact-json'] === true,
});
```

### Log Output Format

```json
{
  "type": "log",
  "level": "info",
  "timestamp": "2026-01-23T...",
  "message": "Agent started"
}
```

### Status Output Format

```json
{
  "type": "status",
  "mode": "stdin-stream",
  "message": "Agent CLI in continuous listening mode..."
}
```

### Error Output Format

```json
{
  "type": "error",
  "errorType": "ValidationError",
  "message": "Invalid JSON input..."
}
```

### Input Confirmation (Added)

```javascript
outputInput(
  {
    raw: trimmedInput,
    parsed: request,
    format: isInteractive ? 'text' : 'json',
  },
  compactJson
);
```

Output:

```json
{
  "type": "input",
  "timestamp": "2026-01-23T...",
  "raw": "hello world",
  "parsed": { "message": "hello world" },
  "format": "text"
}
```

## Stream Usage Analysis

- `outputStatus()` → `process.stdout`
- `outputError()` → `process.stderr`
- `Log` → `Bun.stdout` (always stdout after fix)
- Event handlers → `process.stdout`
- Console.log in unused code → stdout
- Console.error in unused code → stderr

## Test Results

- Read tool validation: Outputs to stdout when successful
- CLI help: Status messages to stdout
- Error conditions: Errors to stderr
- Log output: Now always to stdout in JSON format
