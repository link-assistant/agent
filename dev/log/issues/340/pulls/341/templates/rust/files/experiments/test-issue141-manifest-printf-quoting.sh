#!/usr/bin/env bash
# Reproduces issue #141: the multi-architecture manifest step in
# .github/workflows/release.yml built its digest list with a single-quoted
# printf format, so ${DOCKERHUB_IMAGE} was passed through literally
# (shellcheck SC2016) and `docker buildx imagetools create` received an
# invalid image reference.
#
# Usage: bash experiments/test-issue141-manifest-printf-quoting.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$repo_root/.github/workflows/release.yml"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
touch abc123 def456

export DOCKERHUB_IMAGE=myorg/myimage

echo "== buggy form (single quotes) =="
# Deliberately reproduce the literal expansion bug.
# shellcheck disable=SC2016
mapfile -t buggy < <(printf '${DOCKERHUB_IMAGE}@sha256:%s\n' *)
printf '  %s\n' "${buggy[@]}"

echo "== fixed form (double quotes) =="
mapfile -t fixed < <(printf "${DOCKERHUB_IMAGE}@sha256:%s\n" *)
printf '  %s\n' "${fixed[@]}"

failed=0

for ref in "${fixed[@]}"; do
  case "$ref" in
    "${DOCKERHUB_IMAGE}@sha256:"*) ;;
    *) echo "FAIL: fixed form did not expand DOCKERHUB_IMAGE: $ref"; failed=1 ;;
  esac
done

# The assertion must match the literal, unexpanded variable.
# shellcheck disable=SC2016
if printf '%s\n' "${buggy[@]}" | grep -qF '${DOCKERHUB_IMAGE}'; then
  echo "OK: buggy form reproduces the unexpanded reference"
else
  echo "FAIL: expected the single-quoted form to leave \${DOCKERHUB_IMAGE} literal"
  failed=1
fi

# Regression guard: the workflow itself must not use the single-quoted format.
if grep -qF "printf '\${DOCKERHUB_IMAGE}@sha256:%s\\n'" "$workflow"; then
  echo "FAIL: $workflow still uses the single-quoted printf format"
  failed=1
else
  echo "OK: $workflow uses the double-quoted printf format"
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "All checks passed."
