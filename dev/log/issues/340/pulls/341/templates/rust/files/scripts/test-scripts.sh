#!/usr/bin/env bash
# Run the inline `#[cfg(test)]` unit-test suites of every rust-script in scripts/.
#
# `cargo test` only builds the library crate, so these suites — including the
# regression guard on rebase-before-stage ordering in version-and-commit.rs —
# do not run unless they are invoked explicitly. Run this locally before
# touching anything under scripts/.
#
# Every suite is attempted even after one fails, so a single broken script does
# not hide the state of the others; the aggregate exit code is non-zero if any
# suite failed.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# Match how CI compiles the rest of the tree, so dead-code and unused-import
# warnings introduced by the test harness surface here rather than in CI.
export RUSTFLAGS="${RUSTFLAGS:--Dwarnings}"

status=0
failed=()

for f in scripts/*.rs; do
  grep -q 'cfg(test)' "$f" || continue
  echo "::group::rust-script --test $f"
  if ! rust-script --test "$f"; then
    status=1
    failed+=("$f")
  fi
  echo "::endgroup::"
done

if [ "$status" -ne 0 ]; then
  echo "Failed script test suites:" >&2
  printf '  %s\n' "${failed[@]}" >&2
fi

# Exercise CLI guards in isolated Git repositories, and registry/link mocks.
if ! python3 experiments/issue-188-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-190-rename-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-192-release-io-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-215-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-218-registry-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-224-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-228-git-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-226-regressions.py -v; then
  status=1
fi
if ! python3 experiments/issue-223-artifact-tests.py -v; then
  status=1
fi
if ! node --test experiments/issue-224-native.mjs experiments/issue-196-*.mjs scripts/*.test.mjs; then
  status=1
fi
exit "$status"
