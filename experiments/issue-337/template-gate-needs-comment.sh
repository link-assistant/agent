#!/usr/bin/env bash
# Reproduce: the js template's check-status-gate-covers-all-jobs.mjs stops
# reading a block-form `needs:` list at the first comment or blank line, so a
# covered job is reported as a hole (and a trailing `# comment` drops a job).
# Usage: template-gate-needs-comment.sh <js-template-clone>
set -euo pipefail
tpl="$(cd "$1" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp "$tpl/scripts/check-status-gate-covers-all-jobs.mjs" "$work/check.mjs"
cat > "$work/demo.yml" <<'YAML'
name: Demo
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: []
  test:
    runs-on: ubuntu-latest
    steps: []
  release:
    runs-on: ubuntu-latest
    steps: []
  pipeline-status:
    needs:
      - lint
      # Release jobs
      - test
      - release # publishes
    if: always()
    runs-on: ubuntu-latest
    steps: []
YAML
cd "$work"
env -i PATH="$PATH" node check.mjs demo.yml && echo "exit 0" || echo "exit $?"
