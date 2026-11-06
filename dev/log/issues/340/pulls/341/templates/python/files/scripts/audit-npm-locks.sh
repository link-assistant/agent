#!/usr/bin/env bash
# Audit every committed npm lockfile (issue #132).
#
# scripts/audit_dependencies.py covers the Python surfaces only. The artifact
# action's package-lock.json is bundled into the dist/ code that runs in every
# artifact upload and download, so an advisory against it must fail the
# scheduled Security run, not only raise a Dependabot alert nobody reads.
#
# Usage:
#   bash scripts/audit-npm-locks.sh            # audit every tracked lockfile
#   bash scripts/audit-npm-locks.sh --list     # print the lockfiles it audits
#
# NPM_AUDIT_LEVEL sets the minimum failing severity (default: moderate). The
# locks are small and fully under this template's control, so even moderate
# advisories are worth fixing.

set -euo pipefail

level="${NPM_AUDIT_LEVEL:-moderate}"
mapfile -t locks < <(git ls-files -- ':(glob)**/package-lock.json')

if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${locks[@]}"
  exit 0
fi

if ((${#locks[@]} == 0)); then
  echo "::notice::No package-lock.json is tracked; nothing to audit."
  exit 0
fi

failed=()
for lock in "${locks[@]}"; do
  directory="$(dirname -- "$lock")"
  echo "::group::npm audit $lock (--audit-level=$level)"
  if ! (cd -- "$directory" && npm audit --package-lock-only --audit-level="$level"); then
    failed+=("$lock")
  fi
  echo "::endgroup::"
done

if ((${#failed[@]} > 0)); then
  for lock in "${failed[@]}"; do
    echo "::error file=$lock::npm audit found $level or higher advisories in $lock."
  done
  echo ""
  echo "How to fix:"
  echo "  1. Run 'npm audit --package-lock-only' in the lockfile's directory to list the advisories."
  echo "  2. Upgrade the dependency, or add an npm 'overrides' entry for a patched transitive version."
  echo "  3. For .github/actions/artifact, rebuild and commit dist (see docs/ci-evidence.md)."
  exit 1
fi
echo "Audited ${#locks[@]} npm lockfile(s): no $level or higher advisories."
