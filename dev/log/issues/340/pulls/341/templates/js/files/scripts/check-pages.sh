#!/usr/bin/env bash
# Check that GitHub Pages is enabled with GitHub Actions as its source, which
# actions/configure-pages and actions/deploy-pages need on the default branch.
#
# Pull requests never run the Pages steps, so without this check a disabled
# site surfaces only after merge, as configure-pages' bare "Not Found".
# The source is a repository setting only a maintainer can change, so:
#   PAGES_MODE=warn    -- pull requests: annotate, write enabled=false and
#                         exit 0 so the pull request is not blocked.
#   PAGES_MODE=require -- default branch: fail with the setting to change
#                         until Pages is enabled with the GitHub Actions source.
# The API answers 404 both for a disabled site and for a request it does not
# authorise, so the job running this check grants `pages: read` explicitly.
# Any other failure fails closed in both modes.
set -euo pipefail

: "${REPOSITORY:?REPOSITORY is required (owner/name)}"

mode="${PAGES_MODE:-require}"
output="${GITHUB_OUTPUT:-/dev/null}"
verbose="${PAGES_VERBOSE:-0}"
settings_url="https://github.com/${REPOSITORY}/settings/pages"
instruction="Open ${settings_url} and set Build and deployment -> Source to GitHub Actions, then re-run this workflow."

trace() { [ "${verbose}" = "1" ] && echo "[pages] $*" >&2 || true; }

case "${mode}" in
  warn | require) ;;
  *)
    echo "::error::PAGES_MODE must be warn or require, got '${mode}'."
    exit 2
    ;;
esac

stderr_file="$(mktemp)"
trap 'rm -f "${stderr_file}"' EXIT

if build_type="$(gh api "repos/${REPOSITORY}/pages" --jq '.build_type // ""' 2>"${stderr_file}")"; then
  trace "build_type=${build_type}"
  if [ "${build_type}" = "workflow" ]; then
    echo "GitHub Pages is enabled for ${REPOSITORY} with the GitHub Actions source."
    echo "enabled=true" >>"${output}"
    exit 0
  fi
  problem="GitHub Pages for ${REPOSITORY} builds from '${build_type:-unknown}', not from GitHub Actions"
else
  trace "gh api stderr: $(cat "${stderr_file}")"
  if ! grep -q 'HTTP 404' "${stderr_file}"; then
    echo "::error::Could not query GitHub Pages of ${REPOSITORY}: $(cat "${stderr_file}")"
    exit 1
  fi
  problem="GitHub Pages is not enabled for ${REPOSITORY}"
fi

echo "enabled=false" >>"${output}"
if [ "${mode}" = "warn" ]; then
  echo "::warning::${problem}, so the example app will not deploy from main. ${instruction}"
  exit 0
fi
echo "::error::${problem}, so the example app cannot deploy. A maintainer must act: ${instruction}"
exit 1
