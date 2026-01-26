#!/usr/bin/env bash
# Test script for Groq provider - simple message without tool calls
# Usage: ./experiments/test-groq-simple.sh [model]
# Example: ./experiments/test-groq-simple.sh llama-3.3-70b-versatile

set -e

MODEL="${1:-llama-3.3-70b-versatile}"
FULL_MODEL="groq/$MODEL"

echo "Testing Groq provider with model: $FULL_MODEL"
echo "Test type: Simple message (no tool calls expected)"
echo ""

# Check for API key
if [ -z "$GROQ_API_KEY" ]; then
  echo "⚠️  Warning: GROQ_API_KEY is not set. This test will fail."
  echo "Set it with: export GROQ_API_KEY=your_api_key_here"
  echo ""
fi

# Create test input - simple question that shouldn't require tools
TEST_INPUT='{"message": "What is 2 + 2? Answer with just the number."}'

echo "Input: $TEST_INPUT"
echo ""
echo "Running test..."
echo ""

# Run the agent
echo "$TEST_INPUT" | timeout 60s bun run src/index.js --model "$FULL_MODEL" > /tmp/groq-simple-test.log 2>&1 || EXIT_CODE=$?

echo "Exit code: ${EXIT_CODE:-0}"
echo ""
echo "Output:"
cat /tmp/groq-simple-test.log

# Check for success
if [ "${EXIT_CODE:-0}" -eq 0 ]; then
  echo ""
  echo "✅ Test PASSED: Agent completed successfully"

  # Check if response contains "4"
  if grep -q '"4"' /tmp/groq-simple-test.log || grep -q ': 4' /tmp/groq-simple-test.log || grep -q '"text":"4"' /tmp/groq-simple-test.log; then
    echo "✅ Response validation: Contains expected answer '4'"
  else
    echo "⚠️  Response may not contain the expected answer '4'"
  fi
elif [ "${EXIT_CODE:-0}" -eq 124 ]; then
  echo ""
  echo "⚠️  Test TIMEOUT: Agent took too long"
  exit 1
else
  echo ""
  echo "❌ Test FAILED: Agent exited with code ${EXIT_CODE:-0}"
  exit 1
fi
