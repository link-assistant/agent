#!/usr/bin/env bash
# All stages must finish successfully on the exact requested, clean revision.
# No toolchain install or Rust command belongs in this prerequisite.
set -euo pipefail
: "${EXPECTED_SHA:?EXPECTED_SHA is required}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected an immutable 40-character SHA' >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$EXPECTED_SHA" ] || { echo 'Checkout revision mismatch' >&2; exit 1; }
for variable in JAVASCRIPT_COMMAND PARITY_COMMAND TRANSLATION_COMMAND; do
  command="${!variable:-}"
  [[ "$command" =~ [^[:space:]] ]] || { echo "Missing $variable" >&2; exit 1; }
  echo "::group::$variable"
  bash -e -o pipefail -c "$command"
  echo '::endgroup::'
  [ "$(git rev-parse HEAD)" = "$EXPECTED_SHA" ] || { echo 'Revision changed during checks' >&2; exit 1; }
done
git diff --exit-code
git diff --cached --exit-code
[ -z "$(git ls-files --others --exclude-standard)" ] || { echo 'Untracked generated drift' >&2; exit 1; }
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'sha=%s\n' "$EXPECTED_SHA" >> "$GITHUB_OUTPUT"; fi
