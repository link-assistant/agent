#!/bin/bash
# Examples for Agent CLI stdin mode functionality
# Issue #76 - Comprehensive stdin handling

echo "=== Agent CLI Stdin Mode Examples ==="
echo ""

# Example 1: Simple piped input (plain text)
echo "Example 1: Simple piped input (plain text)"
echo "Command: echo 'Hello, how are you?' | agent"
echo "---"
# Uncomment to run:
# echo 'Hello, how are you?' | agent

# Example 2: Simple piped input (JSON)
echo ""
echo "Example 2: Simple piped input (JSON)"
echo 'Command: echo '"'"'{"message":"Hello, how are you?"}'"'"' | agent'
echo "---"
# Uncomment to run:
# echo '{"message":"Hello, how are you?"}' | agent

# Example 3: Direct prompt with -p flag
echo ""
echo "Example 3: Direct prompt with -p flag (bypasses stdin)"
echo "Command: agent -p 'What is 2+2?'"
echo "---"
# Uncomment to run:
# agent -p 'What is 2+2?'

# Example 4: Multi-line input (auto-merged by default)
echo ""
echo "Example 4: Multi-line input (auto-merged into single message)"
echo "Command: printf 'Line 1\nLine 2\nLine 3' | agent"
echo "---"
# Uncomment to run:
# printf 'Line 1\nLine 2\nLine 3' | agent

# Example 5: Non-interactive mode (JSON only)
echo ""
echo "Example 5: Non-interactive mode (JSON only, rejects plain text)"
echo 'Command: echo '"'"'{"message":"Hello"}'"'"' | agent --no-interactive'
echo "---"
# Uncomment to run:
# echo '{"message":"Hello"}' | agent --no-interactive

# Example 6: Disable auto-merge of queued messages
echo ""
echo "Example 6: Disable auto-merge of queued messages"
echo 'Command: echo '"'"'{"message":"Hello"}'"'"' | agent --no-auto-merge-queued-messages'
echo "---"
# Uncomment to run:
# echo '{"message":"Hello"}' | agent --no-auto-merge-queued-messages

# Example 7: Stdin with timeout
echo ""
echo "Example 7: Stdin with timeout (5 seconds)"
echo "Command: agent --stdin-stream-timeout 5000"
echo "Note: This will wait for stdin input for 5 seconds, then exit if no input received"
echo "---"
# Uncomment to run:
# agent --stdin-stream-timeout 5000

# Example 8: Programmatic JSON input from file
echo ""
echo "Example 8: Reading input from file"
echo "Command: cat input.json | agent"
echo "Where input.json contains: {\"message\": \"Process this file content\"}"
echo "---"

# Example 9: Using here-doc for multi-line JSON
echo ""
echo "Example 9: Using here-doc for multi-line input"
cat << 'HEREDOC'
Command:
cat << 'EOF' | agent
{
  "message": "This is a multi-line message.\nIt spans multiple lines."
}
EOF
HEREDOC
echo "---"

# Example 10: Pipeline with other commands
echo ""
echo "Example 10: Pipeline with other commands"
echo "Command: git diff | agent -p 'Review these changes'"
echo "---"

echo ""
echo "=== CLI Flags Reference ==="
echo ""
echo "Stdin Mode Flags:"
echo "  -p, --prompt              Direct prompt (bypasses stdin reading)"
echo "  --disable-stdin           Disable stdin streaming (requires --prompt)"
echo "  --stdin-stream-timeout    Timeout in milliseconds for stdin reading"
echo "  --interactive             Accept plain text input (default: true)"
echo "  --no-interactive          Only accept JSON input"
echo "  --auto-merge-queued-messages    Merge rapidly arriving lines (default: true)"
echo "  --no-auto-merge-queued-messages Treat each line as separate message"
echo ""
echo "For more options, run: agent --help"
