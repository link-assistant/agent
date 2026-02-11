#!/bin/bash
# Experiment: Test if symlinking bun as 'agent' changes the process name in top/ps

# Create a temporary symlink
TMPDIR=$(mktemp -d)
ln -s "$(which bun)" "$TMPDIR/agent"

echo "Created symlink: $TMPDIR/agent -> $(which bun)"

# Run using the symlink
"$TMPDIR/agent" "$(dirname "$0")/test-wrapper-target.js"

# Cleanup
rm -rf "$TMPDIR"
