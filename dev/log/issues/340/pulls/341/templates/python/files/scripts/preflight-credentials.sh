#!/usr/bin/env bash
#
# Prove the release credentials can write before any expensive job runs.
#
# Principle 16 of the shared CI/CD best practices ("Prove You Can Publish
# Before You Build", issues #74 and #77). A non-empty secret proves nothing
# (an expired token is non-empty), and a login -- or a registry token
# endpoint -- proves authentication, not authorisation: auth.docker.io
# answers an anonymous pull,push request with 200 and silently narrows the
# grant to pull. The only form of the check that is not a guess is an
# attempted write:
#   - PyPI trusted publishing: exchange the workflow's OIDC token for a
#     short-lived upload token at /_/oidc/mint-token -- exactly what the
#     publish step does. Nothing is uploaded.
#   - Docker Hub: POST /v2/<repo>/blobs/uploads/ -> 202 opens an upload
#     session, DELETE cancels it, nothing is stored and no tag moves.
#
# PREFLIGHT_MODE:
#   release -- push to main / manual instant release. A refused credential
#              fails the run here, before the publishing job spends a minute.
#   report  -- pull requests, where a fork legitimately has no publishing
#              secrets. The same probes run and annotate, but never block.
#
# Rules each caller depends on (each is a defect if dropped):
#   1. Report every failure, not the first -- no probe aborts the script.
#   2. Report `unknown`, never a guess: a timeout or a 429 has not said the
#      credential is broken. But a release-mode run that verified nothing is
#      not a pass.
#   3. Probe with a write, not a login.
#
# No set -e on purpose: rule 1 means one failed probe must not hide the rest.

set -u

MODE="${PREFLIGHT_MODE:-report}"
PYPI_API="${PYPI_API:-https://pypi.org}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-https://registry-1.docker.io}"
DOCKER_AUTH="${DOCKER_AUTH:-https://auth.docker.io}"
CURL_TIMEOUT="${PREFLIGHT_CURL_TIMEOUT:-15}"
NEWLINE=$'\n'

verified=0
n_fail=0
n_unknown=0
failures=''
unknowns=''

ok() {
  verified=$((verified + 1))
  printf '  PASS: %s\n' "$*"
}

bad() {
  n_fail=$((n_fail + 1))
  failures="${failures}${failures:+${NEWLINE}}$1"
  printf '  FAIL: %s\n' "$*"
}

unknown() {
  n_unknown=$((n_unknown + 1))
  unknowns="${unknowns}${unknowns:+${NEWLINE}}$1"
  printf '  UNKNOWN: %s\n' "$*"
}

# curl that separates the HTTP status from the body without temp files.
# Prints "body\nstatus"; a network failure yields an empty status, which the
# callers treat as unknown.
http() {
  local body
  body=$(curl -sS --max-time "$CURL_TIMEOUT" -o - -w "${NEWLINE}%{http_code}" "$@" 2>/dev/null)
  printf '%s\n%s' "${body%"${NEWLINE}"*}" "${body##*"$NEWLINE"}"
}

CURL_USER_AGENT="release-preflight (github.com/link-foundation/python-ai-driven-development-pipeline-template)"

# First match of `"key": "<value>"` in a JSON payload -- enough for the flat
# responses in play here and free of jq/node dependencies this template does
# not otherwise have.
json_string() {
  printf '%s' "$1" | sed -n "s/.*\"$2\" *: *\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# Warehouse's 422 body is structured JSON, often with multiple lines. Decode
# only the first error; never print the raw response or any minted token.
pypi_error() {
  PYPI_ERROR_BODY="$1" python3 - <<'PY'
import json
import os

try:
    error = json.loads(os.environ['PYPI_ERROR_BODY'])['errors'][0]
    code = error['code']
    if not isinstance(code, str):
        raise ValueError('invalid error code')
    print(code)
    if code in {'invalid-publisher', 'invalid-pending-publisher'}:
        description = error.get('description', '')
        if isinstance(description, str):
            print(' '.join(description.split()))
except (ValueError, KeyError, IndexError, TypeError):
    pass
PY
}

pypi_publisher_help() {
  local repo="${GITHUB_REPOSITORY:-unknown/unknown}"
  local workflow="${GITHUB_WORKFLOW_REF:-release.yml}"
  local script_dir manifest project response status
  workflow="${workflow%@*}"
  workflow="${workflow##*/}"
  printf 'A PyPI maintainer must add a GitHub trusted publisher with owner=%s, repository=%s, workflow=%s, environment=(blank). ' \
    "${repo%%/*}" "${repo#*/}" "$workflow"
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  manifest=pyproject.toml
  [ -f "$manifest" ] || manifest=python/pyproject.toml
  project="$(python3 "$script_dir/read_manifest.py" "$manifest" --field project.name 2>/dev/null)"
  if [ -z "$project" ]; then
    printf 'Read [project].name in pyproject.toml to choose the project publishing settings, or create a pending publisher at %s/manage/account/publishing/.' "$PYPI_API"
    return
  fi
  response="$(http -A "$CURL_USER_AGENT" "$PYPI_API/pypi/$project/json")"
  status="${response##*"$NEWLINE"}"
  case "$status" in
    200)
      printf 'Add it to the existing project "%s" at %s/manage/project/%s/settings/publishing/. If that project is not yours, rename [project].name in pyproject.toml first.' \
        "$project" "$PYPI_API" "$project"
      ;;
    404)
      printf 'Create a pending publisher for "%s" at %s/manage/account/publishing/.' "$project" "$PYPI_API"
      ;;
    *)
      printf 'The project lookup answered %s, so project existence is unknown. If "%s" exists, use %s/manage/project/%s/settings/publishing/; otherwise create a pending publisher at %s/manage/account/publishing/.' \
        "${status:-no status}" "$project" "$PYPI_API" "$project" "$PYPI_API"
      ;;
  esac
}

# The publishing jobs use PyPI trusted publishing (pypa/gh-action-pypi-publish
# with no password): GitHub mints an OIDC token for the job, and PyPI exchanges
# it for a short-lived upload token. The exchange IS the publish credential
# check -- PyPI validates the trusted-publisher mapping at mint time -- and
# minting a token uploads nothing. Requires id-token: write on this job.
check_pypi() {
  local request_url="${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
  local request_token="${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}"
  local response status oidc_token

  printf 'PyPI:\n'

  if [ -z "$request_url" ] || [ -z "$request_token" ]; then
    bad 'no OIDC token available: ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN are unset -- the job needs id-token: write, and pypa/gh-action-pypi-publish would fail to authenticate'
    return 0
  fi

  # The publish action requests the OIDC token with the `pypi` audience; the
  # default ACTIONS_ID_TOKEN_REQUEST_URL already carries ?audience=... so & is
  # what the real flow uses.
  response=$(http -A "$CURL_USER_AGENT" -H "Authorization: Bearer ${request_token}" \
    "${request_url}&audience=pypi")
  status="${response##*"$NEWLINE"}"
  oidc_token=$(json_string "${response%"${NEWLINE}"*}" value)

  case "$status" in
    200)
      if [ -z "$oidc_token" ]; then
        unknown 'the GitHub OIDC endpoint answered 200 but returned no token'
        return 0
      fi
      ;;
    '')
      unknown 'the GitHub OIDC endpoint was unreachable during the token request'
      return 0
      ;;
    *)
      unknown "the GitHub OIDC endpoint answered ${status} to the token request (no verdict on trusted publishing)"
      return 0
      ;;
  esac

  response=$(http -A "$CURL_USER_AGENT" -H 'Content-Type: application/json' \
    -d "{\"token\": \"${oidc_token}\"}" "${PYPI_API}/_/oidc/mint-token")
  status="${response##*"$NEWLINE"}"

  case "$status" in
    200)
      # The response carries a short-lived upload token; it is deliberately
      # not printed.
      ok 'PyPI minted a short-lived upload token via trusted publishing'
      ;;
    400 | 401 | 403)
      bad "PyPI refused to mint an upload token (${status}) -- the trusted-publisher mapping for this repository/workflow is missing or does not match, and the publish step would be rejected"
      ;;
    422)
      local details code description
      details="$(pypi_error "${response%"${NEWLINE}"*}")"
      code="${details%%"$NEWLINE"*}"
      description="${details#*"$NEWLINE"}"
      case "$code" in
        invalid-publisher | invalid-pending-publisher)
          bad "PyPI refused to mint an upload token (422 ${code}: ${description}) -- the publish step would be rejected the same way. $(pypi_publisher_help)"
          ;;
        *)
          unknown "PyPI answered 422${code:+ ($code)} to the mint-token probe (no verdict on trusted publishing)"
          ;;
      esac
      ;;
    '')
      unknown 'PyPI was unreachable during the mint-token probe'
      ;;
    *)
      unknown "PyPI answered ${status} to the mint-token probe (no verdict on trusted publishing)"
      ;;
  esac

  return 0
}

check_docker_hub() {
  local image="${DOCKERHUB_IMAGE:-}"
  local username="${DOCKERHUB_USERNAME:-}"
  local token="${DOCKERHUB_TOKEN:-}"

  printf 'Docker Hub:\n'

  if [ -z "$image" ]; then
    printf '  SKIP: DOCKERHUB_IMAGE is not set -- Docker publishing is disabled (the release workflow disables it with the same condition)\n'
    return 0
  fi

  if [ -z "$username" ] || [ -z "$token" ]; then
    bad "DOCKERHUB_IMAGE is set (${image}) but DOCKERHUB_USERNAME or DOCKERHUB_TOKEN is missing -- docker-publish would fail at login"
    return 0
  fi

  # The token request below is only a means to the write probe: the endpoint
  # hands out 200 + a token for any scope without proving the scope can be
  # granted, so its answer proves nothing.
  local response registry_token
  response=$(http -u "$username:$token" \
    "$DOCKER_AUTH/token?service=registry.docker.io&scope=repository:${image}:pull,push")
  registry_token=$(json_string "${response%"${NEWLINE}"*}" token)
  if [ -z "$registry_token" ]; then
    unknown 'the Docker Hub auth endpoint did not return a usable token'
    return 0
  fi

  local headers status location
  headers=$(curl -sS --max-time "$CURL_TIMEOUT" -D - -o /dev/null \
    -X POST -H "Authorization: Bearer $registry_token" \
    "$DOCKER_REGISTRY/v2/${image}/blobs/uploads/" 2>/dev/null)
  if [ -z "$headers" ]; then
    unknown 'the Docker Hub registry was unreachable during the write probe'
    return 0
  fi
  status=$(printf '%s\n' "$headers" | awk 'NR==1{gsub(/\r/,"");print $2}')
  location=$(printf '%s\n' "$headers" | awk 'tolower($1)=="location:"{gsub(/\r/,"");print $2; exit}')

  case "$status" in
    202)
      # Cancel the opened upload session so nothing is stored.
      if [ -n "$location" ]; then
        curl -sS --max-time "$CURL_TIMEOUT" -o /dev/null -X DELETE \
          -H "Authorization: Bearer $registry_token" "$location" 2>/dev/null || true
      fi
      ok "Docker Hub accepted a blob-upload write for ${image} (202; upload session cancelled)"
      ;;
    401 | 403)
      bad "Docker Hub refused the write for ${image} (${status}) -- the token cannot push this repository; the login the publishing jobs run would still have succeeded"
      ;;
    404)
      bad "Docker Hub reports ${image} as unknown (404) -- check DOCKERHUB_IMAGE and DOCKERHUB_USERNAME"
      ;;
    429)
      unknown 'Docker Hub rate-limited the write probe (429)'
      ;;
    *)
      unknown "Docker Hub answered ${status:-no status} to the write probe (no verdict on the credential)"
      ;;
  esac

  return 0
}

emit_annotations() {
  local level="$1" list="$2"
  [ -n "$list" ] || return 0
  printf '%s\n' "$list" | while IFS= read -r line; do
    [ -n "$line" ] && printf '::%s::release-preflight: %s\n' "$level" "$line"
  done
}

append_summary() {
  local verdict="$1" list
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    printf '### Release preflight (%s mode)\n\n' "$MODE"
    printf '**Verdict: %s**\n\n' "$verdict"
    printf '| verdict | count |\n| --- | --- |\n'
    printf '| verified | %d |\n' "$verified"
    printf '| failed | %d |\n' "$n_fail"
    printf '| unknown | %d |\n' "$n_unknown"
    for list in "$failures" "$unknowns"; do
      [ -n "$list" ] || continue
      printf '%s\n' "$list" | while IFS= read -r line; do
        [ -n "$line" ] && printf -- '- %s\n' "$line"
      done
    done
  } >> "$GITHUB_STEP_SUMMARY"
}

check_pypi
check_docker_hub

printf '\nRelease preflight: %d verified, %d failed, %d unknown\n' \
  "$verified" "$n_fail" "$n_unknown"

if [ "$n_fail" -gt 0 ]; then
  if [ "$MODE" = 'release' ]; then
    emit_annotations error "$failures"
    append_summary failed
    printf '::error::release-preflight: refusing to release with %d refused credential(s)\n' "$n_fail"
    exit 1
  fi
  emit_annotations warning "$failures"
  append_summary failed
  printf 'Report mode: the failures above are advisory -- pull requests may come from forks without publishing secrets.\n'
  exit 0
fi

if [ "$verified" -eq 0 ]; then
  # Rule 2, second half: every probe came back unknown (or there was nothing
  # to probe). That is not a pass in release mode -- a release would run on
  # pure hope.
  if [ "$MODE" = 'release' ]; then
    emit_annotations warning "$unknowns"
    append_summary unverified
    printf '::error::release-preflight: verified nothing (%d unknown) -- refusing to release on an unproven credential set\n' "$n_unknown"
    exit 1
  fi
  emit_annotations warning "$unknowns"
  append_summary unverified
  printf 'Report mode: nothing was verified -- advisory only.\n'
  exit 0
fi

append_summary passed
exit 0
