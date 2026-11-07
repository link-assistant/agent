#!/usr/bin/env bash
# Reproduction for issue #139: in the multi-language (rust/) layout the
# exclusion list of scripts/detect-code-changes.rs never matched, so an
# examples-only pull request reported any-code-changed=true.
#
# Usage: experiments/issue-139-multi-language-detect-code-changes.sh
# Expects: any-code-changed=false, rs-changed=false
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
cd "$W"

git init -q .
git config user.email a@b.c
git config user.name t
mkdir -p scripts rust/examples
cp "$REPO_ROOT/scripts/detect-code-changes.rs" "$REPO_ROOT/scripts/rust-paths.rs" scripts/
printf '[package]\nname = "demo"\nversion = "0.1.0"\n' > rust/Cargo.toml   # multi-language layout
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
echo 'fn main() {}' > rust/examples/demo.rs   # examples/ is on the exclusion list
git add -A && git commit -qm "docs: add an example"

OUT="$(GITHUB_EVENT_NAME=pull_request rust-script scripts/detect-code-changes.rs)"
echo "$OUT"

for expected in "any-code-changed=false" "rs-changed=false"; do
  if ! grep -qx "$expected" <<<"$OUT"; then
    echo "FAIL: expected $expected" >&2
    exit 1
  fi
done
echo "PASS: examples-only change in rust/ is not a code change (base $BASE)"
