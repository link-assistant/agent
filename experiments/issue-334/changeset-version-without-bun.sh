#!/usr/bin/env bash
# Reproduce the 0.26.15 release leaving js/.changeset/*.md behind.
#
# `changeset version` (v3) formats files through the package manager it
# detects. A bun.lock makes that `bun x prettier`; without bun on PATH it
# fails with `spawn bun ENOENT` after bumping package.json and writing
# CHANGELOG.md but before deleting the consumed changeset.
#
# Usage: experiments/issue-334/changeset-version-without-bun.sh [with-bun]
set -u
JS="$(cd "$(dirname "$0")/../../js" && pwd)"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"
git init -q
mkdir .changeset bin
cp "$JS/.changeset/config.json" .changeset/
printf '{"name":"demo","version":"1.0.0"}\n' > package.json
printf -- "---\n'demo': patch\n---\n\nfix: demo\n" > .changeset/demo.md
echo '{}' > .prettierrc
touch bun.lock
ln -s "$JS/node_modules" node_modules
ln -s "$(command -v node)" bin/node
if [ "${1:-}" = "with-bun" ]; then ln -s "$(command -v bun)" bin/bun; fi
PATH="$DIR/bin:/usr/bin:/bin" node node_modules/@changesets/cli/bin.js version
echo "exit=$?"
echo "package.json: $(cat package.json)"
echo "changesets left: $(ls .changeset | grep -v config.json | tr '\n' ' ')"
