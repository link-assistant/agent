#!/usr/bin/env bash
# Test script for Groq provider - message expecting tool calls
# Usage: ./experiments/test-groq-tools.sh [model]
# Example: ./experiments/test-groq-tools.sh llama-3.3-70b-versatile

set -e

MODEL="${1:-llama-3.3-70b-versatile}"
FULL_MODEL="groq/$MODEL"

echo "Testing Groq provider with model: $FULL_MODEL"
echo "Test type: Message expecting tool call"
echo ""

# Check for API key
if [ -z "$GROQ_API_KEY" ]; then
  echo "⚠️  Warning: GROQ_API_KEY is not set. This test will fail."
  echo "Set it with: export GROQ_API_KEY=your_api_key_here"
  echo ""
fi

# Create test input - message that should trigger tool use
TEST_INPUT='{"message": "List the files in the current directory using the bash tool with ls command"}'

echo "Input: $TEST_INPUT"
echo ""
echo "Running test..."
echo ""

# Run the agent
echo "$TEST_INPUT" | timeout 90s bun run src/index.js --model "$FULL_MODEL" > /tmp/groq-tools-test.log 2>&1 || EXIT_CODE=$?

echo "Exit code: ${EXIT_CODE:-0}"
echo ""
echo "Output:"
cat /tmp/groq-tools-test.log

# Check for tool_use event in output
echo ""
if grep -q '"type":"tool_use"' /tmp/groq-tools-test.log || grep -q '"type": "tool_use"' /tmp/groq-tools-test.log; then
  echo "✅ Tool use detected in output"
  TOOL_USE_FOUND=true
else
  echo "⚠️  No tool_use event found in output"
  TOOL_USE_FOUND=false
fi

# Check for success
if [ "${EXIT_CODE:-0}" -eq 0 ]; then
  echo ""
  echo "✅ Test PASSED: Agent completed successfully"

  if [ "$TOOL_USE_FOUND" = true ]; then
    echo "✅ Model successfully used tool calling"
  else
    echo "⚠️  Model completed but did not use tool calling"
    echo "   This may indicate the model doesn't support tools or chose not to use them"
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
