#!/bin/bash
# Test that help (no subcommand) goes to stdout, but errors go to stderr
# This verifies correct distinction per industry standards

cd "$(dirname "$0")/.."

echo "=== Test 1: agent auth (no subcommand = help, should go to stdout) ==="

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)

bun run js/src/index.js auth >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

echo "Exit code: $EXIT_CODE (expected: 0)"
echo "Stdout: $(wc -c < "$STDOUT_FILE") bytes (expected: >0)"
echo "Stderr: $(wc -c < "$STDERR_FILE") bytes (expected: 0)"

PASS=true
[ "$EXIT_CODE" -ne 0 ] && echo "FAIL: exit code" && PASS=false
[ "$(wc -c < "$STDOUT_FILE")" -eq 0 ] && echo "FAIL: stdout empty" && PASS=false
[ "$(wc -c < "$STDERR_FILE")" -gt 0 ] && echo "FAIL: stderr not empty" && PASS=false

rm -f "$STDOUT_FILE" "$STDERR_FILE"

echo ""
echo "=== Test 2: agent --help (explicit help, handled by yargs) ==="

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)

bun run js/src/index.js --help >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

echo "Exit code: $EXIT_CODE (expected: 0)"
echo "Stdout: $(wc -c < "$STDOUT_FILE") bytes (expected: >0)"
echo "Stderr: $(wc -c < "$STDERR_FILE") bytes (expected: 0)"

[ "$(wc -c < "$STDOUT_FILE")" -eq 0 ] && echo "FAIL: stdout empty" && PASS=false

rm -f "$STDOUT_FILE" "$STDERR_FILE"

echo ""
echo "=== Test 3: agent mcp (no subcommand = help, should go to stdout) ==="

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)

bun run js/src/index.js mcp >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

echo "Exit code: $EXIT_CODE (expected: 0)"
echo "Stdout: $(wc -c < "$STDOUT_FILE") bytes (expected: >0)"
echo "Stderr: $(wc -c < "$STDERR_FILE") bytes (expected: 0)"

[ "$EXIT_CODE" -ne 0 ] && echo "FAIL: exit code" && PASS=false
[ "$(wc -c < "$STDOUT_FILE")" -eq 0 ] && echo "FAIL: stdout empty" && PASS=false
[ "$(wc -c < "$STDERR_FILE")" -gt 0 ] && echo "FAIL: stderr not empty" && PASS=false

rm -f "$STDOUT_FILE" "$STDERR_FILE"

echo ""
if [ "$PASS" = true ]; then
  echo "=== ALL TESTS PASSED ==="
else
  echo "=== SOME TESTS FAILED ==="
  exit 1
fi
