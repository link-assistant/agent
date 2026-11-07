#!/usr/bin/env bash
# RUSTFLAGS=-Dwarnings covers rustc, but Cargo's manifest warnings still exit 0.
# Preserve the complete output and the original failure status, and deny warnings.
set -euo pipefail

log_file="${CARGO_WARNING_LOG:-$(mktemp "${TMPDIR:-/tmp}/cargo-warnings.XXXXXX")}"
cargo check --locked --all-targets --all-features --color never "$@" 2>&1 | tee "$log_file"
if grep -E '^warning(:|\[)' "$log_file"; then
  echo "::error::Cargo reported warnings; full output: $log_file" >&2
  exit 1
fi
