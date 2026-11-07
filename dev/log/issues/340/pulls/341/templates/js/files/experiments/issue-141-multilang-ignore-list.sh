#!/usr/bin/env bash
# Reproduction for issue #141: the ignore list never matched in the
# multi-language (js/) layout. Uses the local copy of the script.
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/detect-code-changes.mjs"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; cd "$W"
git init -q .; git config user.email a@b.c; git config user.name t
mkdir -p js/examples
echo '{}' > js/package.json            # multi-language layout
git add -A; git commit -qm base
echo '// demo' > js/examples/demo.mjs  # examples/ is on the ignore list
git add -A; git commit -qm "docs: add an example"
GITHUB_EVENT_NAME=push node "$SCRIPT"
