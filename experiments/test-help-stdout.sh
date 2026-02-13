#!/bin/bash
# Test that help text goes to stdout (not stderr)
# This verifies the fix for issue #77

cd "$(dirname "$0")/.."

echo "=== Testing: agent auth (no subcommand) ==="

# Run 'agent auth' and capture stdout and stderr separately
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)

bun run js/src/index.js auth >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

STDOUT_SIZE=$(wc -c < "$STDOUT_FILE")
STDERR_SIZE=$(wc -c < "$STDERR_FILE")

echo "Exit code: $EXIT_CODE"
echo "Stdout size: $STDOUT_SIZE bytes"
echo "Stderr size: $STDERR_SIZE bytes"
echo ""

echo "--- STDOUT content ---"
cat "$STDOUT_FILE"
echo ""
echo "--- STDERR content ---"
cat "$STDERR_FILE"
echo ""

# Verify
PASS=true

if [ "$STDOUT_SIZE" -eq 0 ]; then
  echo "FAIL: stdout is empty (help text should be on stdout)"
  PASS=false
else
  echo "PASS: stdout has content ($STDOUT_SIZE bytes)"
fi

if [ "$STDERR_SIZE" -gt 0 ]; then
  echo "FAIL: stderr has content (help text should NOT be on stderr)"
  PASS=false
else
  echo "PASS: stderr is empty"
fi

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "FAIL: exit code should be 0 (help display is not an error)"
  PASS=false
else
  echo "PASS: exit code is 0"
fi

# Check that stdout contains no ANSI color codes
if grep -P '\x1b\[' "$STDOUT_FILE" >/dev/null 2>&1; then
  echo "FAIL: stdout contains ANSI color codes (should be stripped)"
  PASS=false
else
  echo "PASS: no ANSI color codes in stdout"
fi

rm -f "$STDOUT_FILE" "$STDERR_FILE"

if [ "$PASS" = true ]; then
  echo ""
  echo "=== ALL TESTS PASSED ==="
else
  echo ""
  echo "=== SOME TESTS FAILED ==="
  exit 1
fi
