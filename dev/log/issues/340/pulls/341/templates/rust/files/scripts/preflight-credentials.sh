#!/usr/bin/env bash
#
# Prove the release credentials can write before any expensive job runs.
#
# Principle 16 of the shared CI/CD best practices ("Prove You Can Publish
# Before You Build", issues #163 and #167). A non-empty secret proves nothing
# (an expired token is non-empty), and a login -- or a registry token
# endpoint -- proves authentication, not authorisation: auth.docker.io
# answers an anonymous pull,push request with 200 and silently narrows the
# grant to pull. The only form of the check that is not a guess is an
# attempted write: POST /v2/<repo>/blobs/uploads/ -> 202 opens an upload
# session, DELETE cancels it, nothing is stored and no tag moves.
#
# PREFLIGHT_MODE:
#   release -- push to main / manual instant release. A refused credential
#              fails the run here, before the matrix spends a minute.
#   report  -- pull requests, where a fork legitimately has no publishing
#              secrets. The same probes run and annotate, but never block.
#
# Rules each caller depends on (each is a defect if dropped):
#   1. Report every failure, not the first -- no probe aborts the script.
#   2. Report `unknown`, never a guess: a timeout or a 429 has not said the
#      credential is broken. Every configured registry must be verified in
#      release mode.
#   3. Probe with a write, not a login.
#
# No set -e on purpose: rule 1 means one failed probe must not hide the rest.

set -u

MODE="${PREFLIGHT_MODE:-report}"
CRATES_API="${CRATES_API:-https://crates.io}"
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

# Read the selected root manifest without confusing a dependency's name.
crate_name_from_manifest() {
  local root="${RUST_ROOT:-.}"
  if [ "$root" = . ] && [ ! -f Cargo.toml ] && [ -f rust/Cargo.toml ]; then root=rust; fi
  python3 - "$root" <<'PYTHON'
import glob, pathlib, sys, tomllib
root = pathlib.Path(sys.argv[1])
manifest = tomllib.loads((root / 'Cargo.toml').read_text())
if 'package' in manifest:
    print(manifest['package']['name'])
else:
    for member in manifest.get('workspace', {}).get('members', []):
        for path in sorted(glob.glob(str(root / member / 'Cargo.toml'))):
            package = tomllib.loads(pathlib.Path(path).read_text()).get('package')
            if package and package.get('publish') is not False:
                print(package['name'])
                sys.exit(0)
    sys.exit('No publishing package found in workspace')
PYTHON
}

check_crates_io() {
  local token="${CARGO_REGISTRY_TOKEN:-${CARGO_TOKEN:-}}"
  local crate_name result probe_status
  printf 'crates.io:\n'
  if [ "${CRATES_PREFLIGHT_PHASE:-publish}" = availability ] &&
     [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
    ok 'OIDC is available; the publishing job will exchange it and prove the selected credential before building'
    return 0
  fi
  if [ -z "$token" ]; then
    bad 'crates.io has no publish credential: neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set -- cargo publish would fail with 401'
    return 0
  fi
  if ! crate_name=$(crate_name_from_manifest 2>/dev/null); then
    unknown 'crates.io publish probe cannot determine the selected crate name'
    return 0
  fi
  result=$(CARGO_REGISTRY_TOKEN="$token" node "$(dirname "$0")/crates-publish-preflight.mjs" "$crate_name")
  probe_status=$?
  case "$probe_status" in
    0) ok "crates.io $result" ;;
    1) bad "crates.io rejected the publish token or scope: $result" ;;
    *) unknown "crates.io $result" ;;
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

  # The token request below is only a means to the write probe: as measured in
  # issue #167 the endpoint hands out 200 + a token for any scope without
  # proving the scope can be granted, so its answer proves nothing.
  local auth_body payload registry_token
  auth_body=$(http -u "$username:$token" \
    "$DOCKER_AUTH/token?service=registry.docker.io&scope=repository:${image}:pull,push")
  payload="${auth_body%"${NEWLINE}"*}"
  registry_token=$(printf '%s' "$payload" | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
  if [ -z "$registry_token" ]; then
    unknown 'Docker Hub auth endpoint did not return a usable token'
    return 0
  fi

  local headers status location
  headers=$(curl -sS --max-time "$CURL_TIMEOUT" -D - -o /dev/null \
    -X POST -H "Authorization: Bearer $registry_token" \
    "$DOCKER_REGISTRY/v2/${image}/blobs/uploads/" 2>/dev/null)
  if [ -z "$headers" ]; then
    unknown 'Docker Hub registry unreachable during the write probe'
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
    printf '### Release preflight (%s mode): %s\n\n' "$MODE" "$verdict"
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

check_crates_io
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

if [ "$verified" -eq 0 ] || [ "$n_unknown" -gt 0 ]; then
  # Every configured registry must be verified; one verified registry cannot
  # compensate for another registry's unknown result.
  if [ "$MODE" = 'release' ]; then
    emit_annotations warning "$unknowns"
    append_summary unverified
    printf '::error::release-preflight: unverified credential set (%d unknown) -- refusing to release on an unproven credential set\n' "$n_unknown"
    exit 1
  fi
  emit_annotations warning "$unknowns"
  append_summary unverified
  printf 'Report mode: some credentials remain unverified -- advisory only.\n'
  exit 0
fi

append_summary passed
exit 0
