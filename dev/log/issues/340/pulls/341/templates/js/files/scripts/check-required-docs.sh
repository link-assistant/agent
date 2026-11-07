#!/usr/bin/env bash
# check-required-docs.sh
#
# Verifies that required documents exist AND still contain their required
# level-2 headings. A deleted file shows up in any diff as a deletion; a
# deleted section is an ordinary hunk that review skims past, so the
# section -- not just the file -- is what this gate pins.
#
# Headings are matched as whole lines ("## Installation"), never as
# substrings: a table-of-contents entry mentioning Installation is not the
# Installation section.
#
# Usage:
#   bash scripts/check-required-docs.sh            # run the check
#   bash scripts/check-required-docs.sh --list     # print the requirement
#                                                  # table as path<TAB>section
#
# Exit codes:
#   0 = every requirement satisfied
#   1 = at least one requirement violated
#   2 = the check could not run (run outside the repository root)

set -euo pipefail

# Each entry: `path|section|section|...` -- a bare `path` requires only
# that the file exists. To require more, add both the file and the
# sections its readers depend on.
REQUIREMENTS=(
  "README.md|Quick Start|Configuration|Contributing|License"
  "docs/BEST-PRACTICES.md|This Template's Best Practices"
  "docs/CONTRIBUTING.md|Development Workflow|Release Process"
  "CHANGELOG.md"
)

has_heading() {
  local file="$1" section="$2"
  grep -Fxq "## ${section}" "$file"
}

list_requirements() {
  for requirement in "${REQUIREMENTS[@]}"; do
    local path="${requirement%%|*}"
    local sections="${requirement#*|}"
    if [ "$sections" = "$path" ]; then
      sections=''
    fi
    if [ -z "$sections" ]; then
      printf '%s\n' "$path"
      continue
    fi
    local rest="$sections"
    while [ -n "$rest" ]; do
      local section="${rest%%|*}"
      printf '%s\t%s\n' "$path" "$section"
      if [ "$rest" = "$section" ]; then
        rest=''
      else
        rest="${rest#*|}"
      fi
    done
  done
}

if [ "${1:-}" = "--list" ]; then
  list_requirements
  exit 0
fi

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "::error title=check-required-docs::not inside a git repository" >&2
  exit 2
}

FAILURES=''

for requirement in "${REQUIREMENTS[@]}"; do
  path="${requirement%%|*}"
  sections="${requirement#*|}"
  if [ "$sections" = "$path" ]; then
    sections=''
  fi

  if [ ! -f "$path" ]; then
    echo "ERROR: required document $path is missing"
    echo "::error file=$path::Required document is missing. Restore it or update scripts/check-required-docs.sh."
    FAILURES="${FAILURES}${path}|missing file\n"
    continue
  fi

  rest="$sections"
  while [ -n "$rest" ]; do
    section="${rest%%|*}"
    if ! has_heading "$path" "$section"; then
      echo "ERROR: $path is missing the required '## ${section}' section"
      echo "::error file=$path::Required section '## ${section}' is missing. Restore the section or update scripts/check-required-docs.sh."
      FAILURES="${FAILURES}${path}|${section}\n"
    fi
    if [ "$rest" = "$section" ]; then
      rest=''
    else
      rest="${rest#*|}"
    fi
  done
done

VIOLATION_COUNT=$(printf '%b' "$FAILURES" | grep -c . || true)

if [ "$VIOLATION_COUNT" -gt 0 ]; then
  echo ""
  echo "${VIOLATION_COUNT} documentation requirement(s) violated:"
  printf '%b' "$FAILURES" | sed '/^$/d; s/^/  /'
  exit 1
fi

echo "All documentation requirements satisfied (${#REQUIREMENTS[@]} documents checked)."
