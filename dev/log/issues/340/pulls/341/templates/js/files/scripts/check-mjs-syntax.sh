#!/usr/bin/env bash
# check-mjs-syntax.sh
#
# Checks Node.js syntax for every tracked .js, .mjs and .cjs file,
# recursively: nested sources, tests, shipped examples and local actions.
# Historical investigation data (docs/case-studies/, dev/log/) is excluded.
# An empty inventory fails instead of passing without evidence.
#
# Usage:
#   bash scripts/check-mjs-syntax.sh
#
# Exit code 0 = all files pass syntax check; non-zero = syntax error found
# or nothing was checked.

set -euo pipefail

node "$(dirname "$0")/check-javascript-syntax.mjs"
