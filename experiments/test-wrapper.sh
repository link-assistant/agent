#!/bin/bash
# Experiment: Test wrapper script approach with exec -a
# exec -a sets argv[0] which determines what shows in top/ps

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use exec -a to replace the shell with bun, setting argv[0] to 'agent'
exec -a agent bun "$SCRIPT_DIR/test-wrapper-target.js" "$@"
