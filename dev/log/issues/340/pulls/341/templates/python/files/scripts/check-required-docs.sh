#!/usr/bin/env bash
# Validate the repository's key documentation (issue #72).
#
# CI-CD-BEST-PRACTICES principle 12 asks for three checks on documentation:
# size limits (scripts/check_file_size.py), broken links (.github/workflows/
# links.yml), and "the documents that are supposed to exist carry the sections
# other documents link to". This script is the third check: a diff review
# reliably misses a deleted CONTRIBUTING.md or a gutted README, and the link
# checker actually gets greener when the sections that contained the links go
# away.
#
# Usage:
#   bash scripts/check-required-docs.sh          # run the check
#   bash scripts/check-required-docs.sh --list   # print `path<TAB>section`
#
# --list prints the requirement table itself, so tests (and anyone extending
# the table) build fixtures from the same source the check reads instead of
# restating it and drifting from it.

set -euo pipefail

# `path|section|section|...`; a bare `path` requires only that the file exists.
# Keep this table in sync with what the README of the template promises.
REQUIREMENTS=(
  "README.md|Features|Quick Start|Configuration|Contributing|License"
  "CONTRIBUTING.md|Development Setup|Pull Request Process|Changelog Management"
  "CHANGELOG.md"
)

# Prose that mentions the words does not count: a table-of-contents entry is
# not the section it links to. The heading has to be a level-2 heading on a
# line of its own.
has_heading() {
  local file="$1" section="$2"
  grep -Fxq "## ${section}" "$file"
}

print_requirements() {
  local requirement path sections section saved_ifs
  for requirement in "${REQUIREMENTS[@]}"; do
    path="${requirement%%|*}"
    if [ "$path" = "$requirement" ]; then
      printf '%s\n' "$path"
      continue
    fi
    sections="${requirement#*|}"
    saved_ifs=$IFS
    IFS='|'
    set -f
    for section in $sections; do
      printf '%s\t%s\n' "$path" "$section"
    done
    set +f
    IFS=$saved_ifs
  done
}

# A string accumulator, not an array: bash 3.2 -- still what a macOS runner
# ships -- treats `${#empty[@]}` under `set -u` as an unbound variable, so an
# array-based failure list works on Ubuntu and breaks on macOS.
FAILURES=''

add_failure() {
  if [ -n "$FAILURES" ]; then
    FAILURES="${FAILURES}
$1"
  else
    FAILURES="$1"
  fi
}

if [ "${1:-}" = "--list" ]; then
  print_requirements
  exit 0
fi

if [ "${1:-}" != "" ]; then
  echo "usage: bash scripts/check-required-docs.sh [--list]" >&2
  exit 2
fi

while IFS=$'\t' read -r path section; do
  if [ ! -f "$path" ]; then
    add_failure "$path: file is missing"
    continue
  fi
  if [ -n "$section" ] && ! has_heading "$path" "$section"; then
    add_failure "$path: missing required section '## ${section}'"
  fi
done < <(print_requirements)

if [ -n "$FAILURES" ]; then
  echo "Documentation validation failed:"
  while IFS= read -r failure; do
    echo "  $failure"
    echo "::error title=Documentation validation failed::${failure}"
  done <<< "$FAILURES"
  exit 1
fi

echo "All required documentation is present with its required sections."
