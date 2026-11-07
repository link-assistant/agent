#!/usr/bin/env bash
# Check the real container tools and Git credential helper without network writes.
set -euo pipefail

for tool in bash curl git gh node npm sha256sum tar; do
  if ! command -v "$tool" > /dev/null; then
    echo "::error::Preview container is missing required tool: $tool"
    exit 1
  fi
  if [[ "${CI_SCRIPTS_DEBUG:-0}" == 1 ]]; then
    printf '::debug::Preview tool %s: %s\n' "$tool" "$(command -v "$tool")"
  fi
done
gh --version
git --version
node --version
npm --version

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$fixture/gitconfig"
export GH_CONFIG_DIR="$fixture/gh"
export GH_HOST=github.com
export GH_TOKEN=preview-tools-fixture
export GIT_TERMINAL_PROMPT=0
gh auth setup-git
credential="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)"
if [[ "$credential" != *'password=preview-tools-fixture'* ]]; then
  echo '::error::Preview Git credential helper did not return the fixture credential.'
  exit 1
fi
echo 'Preview container tools and GitHub credential helper verified.'
