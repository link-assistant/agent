#!/usr/bin/env bash
# Install rust-script idempotently, reproducibly, and resiliently.
#
# - Short-circuits only when the exact pinned version is cached/preinstalled.
# - Uses --locked so the published Cargo.lock is honored (reproducible builds,
#   immune to broken transitive releases).
# - Retries with backoff so a transient crates.io blip does not fail the job.
set -euo pipefail

RUST_SCRIPT_VERSION="${RUST_SCRIPT_VERSION:-0.36.0}"

if command -v rust-script >/dev/null 2>&1 \
  && [ "$(rust-script --version)" = "rust-script $RUST_SCRIPT_VERSION" ]; then
  echo "rust-script already present: $(rust-script --version)"
  exit 0
fi

for attempt in 1 2 3; do
  if cargo install rust-script --version "$RUST_SCRIPT_VERSION" --locked --force; then
    exit 0
  fi
  echo "cargo install rust-script failed (attempt $attempt/3); retrying..." >&2
  sleep $((attempt * 5))
done

echo "cargo install rust-script failed after 3 attempts" >&2
exit 1
