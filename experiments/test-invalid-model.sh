#!/usr/bin/env bash
# Test script to verify that the agent exits with code 1 when given an invalid model

set -e

echo "Testing agent with invalid model (should fail with exit code 1)..."
echo ""

# Create test input
TEST_INPUT='{"message": "hi"}'

# Run agent with invalid model
echo "$TEST_INPUT" | bun run src/index.js --model anthropic/claude-3-5-sonnet --server false > /tmp/test-output.log 2>&1 || EXIT_CODE=$?

# Check exit code
if [ "${EXIT_CODE:-0}" -eq 1 ]; then
  echo "✓ Test PASSED: Agent exited with code 1 as expected"
  echo ""
  echo "Output:"
  cat /tmp/test-output.log
  exit 0
else
  echo "✗ Test FAILED: Agent exited with code ${EXIT_CODE:-0}, expected 1"
  echo ""
  echo "Output:"
  cat /tmp/test-output.log
  exit 1
fi
