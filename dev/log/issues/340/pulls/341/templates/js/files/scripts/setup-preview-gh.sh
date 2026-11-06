#!/usr/bin/env bash
# Install the reviewed GitHub CLI inside the Linux x64 Playwright container.
# GitHub-hosted runner utilities are not inherited by container jobs.
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"
if [[ "$(uname -s)/$(uname -m)" != Linux/x86_64 ]]; then
  echo '::error::Preview GitHub CLI setup requires Linux x86_64.'
  exit 1
fi

version=2.103.3
checksum=4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d
install_dir="$(mktemp -d "$RUNNER_TEMP/preview-gh.XXXXXX")"
archive="$install_dir/gh.tar.gz"
trap 'rm -f "$archive"' EXIT

curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/cli/cli/releases/download/v${version}/gh_${version}_linux_amd64.tar.gz" \
  --output "$archive"
if ! printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status; then
  echo '::error::Preview GitHub CLI archive checksum mismatch.' >&2
  exit 1
fi
tar -xzf "$archive" -C "$install_dir" --strip-components=2 \
  "gh_${version}_linux_amd64/bin/gh"
"$install_dir/gh" --version
printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
