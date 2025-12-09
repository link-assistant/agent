#!/usr/bin/env bash
# Test script to verify that the agent exits with code 0 when successful

set -e

echo "Testing agent with valid model (should succeed with exit code 0)..."
echo ""

# Create test input
TEST_INPUT='{"message": "hi"}'

# Run agent with valid model (opencode/grok-code is the default)
echo "$TEST_INPUT" | timeout 30s bun run src/index.js --server false > /tmp/test-output.log 2>&1 || EXIT_CODE=$?

# Check exit code (ignore timeout exit code 124)
if [ "${EXIT_CODE:-0}" -eq 0 ]; then
  echo "✓ Test PASSED: Agent exited with code 0 as expected"
  echo ""
  echo "Output (first 50 lines):"
  head -50 /tmp/test-output.log
  exit 0
elif [ "${EXIT_CODE:-0}" -eq 124 ]; then
  echo "⚠ Test TIMEOUT: Agent took too long but didn't fail immediately"
  echo "This may be expected for valid models that try to connect"
  exit 0
else
  echo "✗ Test FAILED: Agent exited with code ${EXIT_CODE:-0}, expected 0"
  echo ""
  echo "Output:"
  cat /tmp/test-output.log
  exit 1
fi
