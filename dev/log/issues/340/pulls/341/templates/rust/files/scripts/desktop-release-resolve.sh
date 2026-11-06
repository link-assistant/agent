#!/usr/bin/env bash
# Resolve the release built by the optional desktop workflow. The normal
# auto-release path tags a child release commit, not workflow_run.head_sha.
set -euo pipefail

EVENT="${EVENT:-}"
REPO="${REPO:?REPO is required}"
TAG="${INPUT_TAG:-${RELEASE_TAG:-}}"
HEAD_SHA="${WORKFLOW_RUN_HEAD_SHA:-}"
SHOULD_BUILD=true

latest_release() {
  gh release view --repo "$REPO" --json tagName --jq .tagName 2>/dev/null || true
}

if [ "$EVENT" = workflow_run ]; then
  if [ -z "$HEAD_SHA" ]; then
    SHOULD_BUILD=false
  else
    # Defensive tier: supports release pipelines that tag the CI commit itself.
    TAG="$(gh api "repos/$REPO/tags?per_page=100" --paginate \
      --jq ".[] | select(.commit.sha == \"$HEAD_SHA\") | .name" 2>/dev/null \
      | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
    if [ -z "$TAG" ]; then
      # Normal tier: this template creates and tags a child release commit.
      TAG="$(latest_release)"
      if [ -n "$TAG" ]; then
        parent="$(gh api "repos/$REPO/commits/$TAG" --jq '.parents[0].sha' 2>/dev/null || true)"
        echo "Resolved latest release $TAG (release parent: ${parent:-unknown}; CI head: $HEAD_SHA)."
      fi
    fi
  fi
fi

[ -n "$TAG" ] || TAG="$(latest_release)"
if [ -z "$TAG" ] || ! gh release view "$TAG" --repo "$REPO" --json tagName >/dev/null 2>&1; then
  SHOULD_BUILD=false
fi

# BUILD-PROVENANCE.txt is uploaded last and is the completion marker. A failed
# or partial matrix has no marker, so a rerun self-heals instead of silently
# accepting a release that contains only some desktop assets.
if [ "$EVENT" = workflow_run ] && [ "$SHOULD_BUILD" = true ]; then
  assets="$(gh release view "$TAG" --repo "$REPO" --json assets \
    --jq '.assets[].name' 2>/dev/null || true)"
  if grep -Fxq BUILD-PROVENANCE.txt <<<"$assets" && grep -Fxq SHA256SUMS.txt <<<"$assets"; then
    SHOULD_BUILD=false
  fi
fi

{
  echo "tag=$TAG"
  echo "should_build=$SHOULD_BUILD"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
