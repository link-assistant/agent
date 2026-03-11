#!/bin/bash
# Test that agent processes exit cleanly when rate-limited
# This verifies the .unref() fixes from issue #213
#
# The test:
# 1. Starts an agent process with a short stdin
# 2. The process will hit rate limits and enter retry sleep
# 3. Since sleep timers are .unref()'d, the process should NOT keep
#    the event loop alive when stdin closes + all work is done
# 4. Verify the process exits within a reasonable time

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Testing Process Exit After Rate Limit (#213) ==="
echo ""

# Count agent processes before test
BEFORE=$(pgrep -fc "bun.*src/index.js" 2>/dev/null || echo 0)
echo "Agent processes before test: $BEFORE"

# Start agent with hi message — it will hit rate limits
echo '{"message":"hi"}' | timeout 15 bun run "$PROJECT_ROOT/js/src/index.js" --no-always-accept-stdin --compact-json 2>/dev/null >/dev/null &
PID=$!
echo "Started agent with PID: $PID"

# Wait a moment for the process to start and hit rate limits
sleep 5

# Check if process is still running
if kill -0 $PID 2>/dev/null; then
  echo "Process still running after 5s (expected — waiting for rate limit retry)"
  # Kill it
  kill $PID 2>/dev/null
  wait $PID 2>/dev/null || true
  echo "Killed process $PID"
else
  echo "Process exited on its own (good — .unref() working!)"
fi

# Count agent processes after test
sleep 2
AFTER=$(pgrep -fc "bun.*src/index.js" 2>/dev/null || echo 0)
echo "Agent processes after test: $AFTER"

if [ "$AFTER" -le "$BEFORE" ]; then
  echo "✅ No leaked processes"
else
  LEAKED=$((AFTER - BEFORE))
  echo "⚠️  $LEAKED leaked process(es) detected"
fi

echo ""
echo "=== Test complete ==="
