#!/usr/bin/env bash
# check-file-line-limits.sh
#
# Enforces the documented 1500-line architecture limit on every tracked
# JavaScript (.js, .mjs, .cjs), Markdown (.md), and YAML (.yml, .yaml)
# file.
#
# This shell gate complements the ESLint `max-lines` rule: ESLint only
# covers source files it lints, while this check walks the tracked file
# list (git ls-files), so source, documentation, and workflow files under
# any name cannot slip past the limit -- and git-ignored build output is
# never flagged.
#
# Intentional exceptions (kept in sync with the eslint.config.js ignore
# list): case-study and generated-data files under
# docs/case-studies/*/data/ mirror external sources verbatim and must not
# be reflowed to satisfy the limit, so they are excluded here.
#
# Usage:
#   bash scripts/check-file-line-limits.sh
#
# Exit codes:
#   0 = every examined file is within the limit
#   1 = at least one examined file exceeds the limit
#   2 = the gate could not run (not a git repository, or nothing was
#       examined) -- "the gate is broken", not "a file is too long"

set -euo pipefail

LIMIT=1500
WARN_THRESHOLD=1350
EXTENSIONS='js|mjs|cjs|md|yml|yaml'
CHECKED=0
# String accumulators, not arrays: bash 3.2 -- what macOS still ships --
# treats ${#empty[@]} under set -u as an unbound variable.
FAILURES=''
WARNINGS=''

# check_file FILE
# Counts lines in FILE and records a warning or failure when it crosses
# the warning threshold or hard limit. The GitHub annotation hint is
# selected by path: workflow files grow through inline run blocks, source
# files through plain size.
check_file() {
  local file="$1"
  local hint
  case "$file" in
    .github/workflows/*)
      hint="Move inline scripts to the ./scripts/ folder to reduce file size."
      ;;
    *)
      hint="Extract code to keep files under the ${LIMIT} line limit."
      ;;
  esac
  local line_count
  line_count=$(wc -l < "$file" | tr -d '[:space:]')
  echo "$file: $line_count lines"
  if [ "$line_count" -gt "$LIMIT" ]; then
    echo "ERROR: $file has $line_count lines (limit: ${LIMIT})"
    echo "::error file=$file::File has $line_count lines (limit: ${LIMIT}). ${hint}"
    FAILURES="${FAILURES}${file}\n"
  elif [ "$line_count" -gt "$WARN_THRESHOLD" ]; then
    echo "WARNING: $file has $line_count lines (approaching limit of ${LIMIT}, warning threshold: ${WARN_THRESHOLD})"
    echo "::warning file=$file::File has $line_count lines (approaching limit of ${LIMIT}). ${hint}"
    WARNINGS="${WARNINGS}${file}\n"
  fi
}

is_exempt() {
  case "$1" in
    docs/case-studies/*/data/*) return 0 ;;
    *) return 1 ;;
  esac
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "::error title=check-file-line-limits::not inside a git repository" >&2
  exit 2
}
cd "$REPO_ROOT"

echo "Checking that JavaScript, Markdown, and workflow files are under ${LIMIT} lines..."

while IFS= read -r -d '' file; do
  case "$file" in
    *.js|*.mjs|*.cjs|*.md|*.yml|*.yaml) ;;
    *) continue ;;
  esac
  is_exempt "$file" && continue
  check_file "$file"
  CHECKED=$((CHECKED + 1))
done < <(git ls-files -z)

echo ""
# A gate that examined nothing has verified nothing: reporting success on
# an empty walk would make every future scope mistake invisible.
if [ "$CHECKED" -eq 0 ]; then
  echo "::error title=check-file-line-limits::no tracked files matched (.${EXTENSIONS//|/, .}); this check verified nothing" >&2
  exit 2
fi

echo ""
if [ -n "$WARNINGS" ]; then
  echo "The following files are approaching the ${LIMIT} line limit (>${WARN_THRESHOLD} lines):"
  printf '%b' "$WARNINGS" | sed '/^$/d; s/^/  /'
  echo ""
  echo "Consider extracting code to prevent concurrent PR merge limit violations."
  echo ""
fi

if [ -n "$FAILURES" ]; then
  echo "The following files exceed the ${LIMIT} line limit:"
  printf '%b' "$FAILURES" | sed '/^$/d; s/^/  /'
  echo ""
  echo "Move large inline scripts to the ./scripts/ folder to reduce file size."
  exit 1
fi

echo "Checked $CHECKED tracked files against a ${LIMIT}-line limit (warning at ${WARN_THRESHOLD})."
echo "All checked files are within the ${LIMIT} line limit!"
