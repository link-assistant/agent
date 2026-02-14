#!/bin/bash
# Test script to verify model parsing with stdin piping
# This simulates: cat prompt.txt | agent --model kilo/glm-5-free --verbose

cd /tmp/gh-issue-solver-1771070098403/js

# Create a test prompt file
echo "Hello, how are you?" > /tmp/test_prompt.txt

echo "=== Test 1: Direct model argument ==="
echo "Running: bun run src/index.js --model kilo/glm-5-free --dry-run --verbose --prompt 'test'"
bun run src/index.js --model kilo/glm-5-free --dry-run --verbose --prompt 'test' 2>&1 | head -50

echo ""
echo "=== Test 2: Piped stdin with model argument ==="
echo "Running: cat /tmp/test_prompt.txt | bun run src/index.js --model kilo/glm-5-free --dry-run --verbose"
cat /tmp/test_prompt.txt | bun run src/index.js --model kilo/glm-5-free --dry-run --verbose --no-always-accept-stdin 2>&1 | head -50

echo ""
echo "=== Test 3: Check argv parsing ==="
# Create a minimal test to check argv parsing
cat > /tmp/test_argv.js << 'EOF'
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

console.log('process.argv:', process.argv);
console.log('hideBin(process.argv):', hideBin(process.argv));

const argv = yargs(hideBin(process.argv))
  .option('model', {
    type: 'string',
    default: 'opencode/kimi-k2.5-free',
  })
  .parse();

console.log('Parsed argv.model:', argv.model);
EOF

echo "stdin test" | bun /tmp/test_argv.js --model kilo/glm-5-free
