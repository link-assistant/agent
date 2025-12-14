#!/bin/bash

# Test that the agent works with the macro restoration

echo "Testing agent in development mode..."
echo '{"message": "What is 2+2? Answer in one word."}' | timeout 30 bun run src/index.js --no-server 2>&1 | head -50
