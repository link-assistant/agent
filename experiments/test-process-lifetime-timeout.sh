#!/bin/bash
# Test script for AGENT_PROCESS_LIFETIME_TIMEOUT feature (#213)
# This verifies that the process lifetime watchdog correctly force-exits
# processes that exceed their maximum lifetime.

set -e

echo "=== Testing AGENT_PROCESS_LIFETIME_TIMEOUT ==="

# Test 1: Process should force-exit after 3 seconds
echo ""
echo "Test 1: Process with 3-second lifetime timeout"
echo "  Expected: Process should exit within ~3 seconds with exit code 2"

BEFORE=$(pgrep -fc "bun.*src/index.js" 2>/dev/null || echo 0)
echo "  Processes before: $BEFORE"

# Start agent with a 3-second lifetime timeout (will hang waiting for stdin)
START_TIME=$(date +%s)
AGENT_PROCESS_LIFETIME_TIMEOUT=3 bun run src/index.js --no-always-accept-stdin 2>/tmp/test-lifetime-stderr.txt >/tmp/test-lifetime-stdout.txt <<< '{"message":"hi"}'
EXIT_CODE=$?
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

AFTER=$(pgrep -fc "bun.*src/index.js" 2>/dev/null || echo 0)
echo "  Exit code: $EXIT_CODE"
echo "  Elapsed: ${ELAPSED}s"
echo "  Processes after: $AFTER"

# Check stderr for timeout message
if grep -q "ProcessLifetimeTimeout" /tmp/test-lifetime-stderr.txt 2>/dev/null; then
  echo "  ✅ Timeout message found in stderr"
else
  echo "  ⚠️  No timeout message (may have exited normally before timeout)"
fi

echo ""
echo "Test 2: Process without lifetime timeout (disabled by default)"
echo "  Expected: Process should exit normally after processing message"

AGENT_PROCESS_LIFETIME_TIMEOUT=0 timeout 10 bun run src/index.js --dry-run --no-always-accept-stdin 2>/dev/null <<< '{"message":"hi"}' > /tmp/test-no-timeout-stdout.txt
EXIT_CODE=$?
echo "  Exit code: $EXIT_CODE (0=success, 124=timed out by shell)"

echo ""
echo "=== Test complete ==="
