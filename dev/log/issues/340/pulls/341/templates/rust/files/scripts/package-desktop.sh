#!/usr/bin/env bash
# Example packaging hook for desktop-release.yml. Replace this script in an
# application template, but preserve its <target-label> <output-dir> contract.
set -euo pipefail

LABEL="${1:?target label is required}"
OUTPUT_DIR="${2:?output directory is required}"
TAG="${DESKTOP_RELEASE_TAG:-dev}"
mkdir -p "$OUTPUT_DIR"
cargo build --release

binary=target/release/example-sum-package-name
extension=""
if [[ "$LABEL" == windows-* ]]; then
  binary+=".exe"
  extension=".exe"
fi
[ -s "$binary" ] || { echo "Expected binary was not built: $binary" >&2; exit 1; }

asset="example-sum-desktop-${LABEL}-${TAG}${extension}"
cp "$binary" "$OUTPUT_DIR/$asset"
echo "Packaged $OUTPUT_DIR/$asset"
