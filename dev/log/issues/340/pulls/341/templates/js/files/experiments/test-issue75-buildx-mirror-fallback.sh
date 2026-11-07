#!/usr/bin/env bash
# Standalone reproduction for issue #75: the publish-dockerhub composite action
# booted buildx with no pinned-image pre-pull, so the docker-container driver
# pulled moby/buildkit:buildx-stable-1 straight from Docker Hub at boot. A
# transient registry-1.docker.io outage there failed the whole publish job.
#
# The fix lives in .github/actions/setup-buildx-resilient/action.yml: pre-pull
# the pinned BuildKit image with retries + a mirror.gcr.io pull-through
# fallback, re-tag the mirror image to the canonical reference, then boot
# buildx with driver-opts pinned to the (now locally cached) image.
#
# This script extracts the real pre-pull `run:` block out of the action and
# drives it with a mock `docker` so the recovery behaviour can be exercised
# offline. The same logic is covered in CI by tests/setup-buildx-resilient.test.js.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="$SCRIPT_DIR/../.github/actions/setup-buildx-resilient/action.yml"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Extract the pre-pull step's `run: |` block verbatim from the action ---
ruby >"$WORK/prepull.sh" <<RUBY
text = File.read("$ACTION", encoding: "UTF-8")
lines = text.lines
start = lines.index { |l| l =~ /^\s*run: \|\s*$/ }
raise "could not find 'run: |' in action.yml" unless start
body = []
indent = nil
lines[(start + 1)..].each do |line|
  break if line =~ /^\s{0,4}- name:/
  if line.strip.empty?
    body << "\n"
    next
  end
  indent ||= line[/^\s*/].length
  body << line[indent..]
end
print body.join
RUBY

if [ ! -s "$WORK/prepull.sh" ]; then
  echo "FAIL: could not extract pre-pull script from action.yml"
  exit 1
fi

# --- Mock docker on PATH; records calls, fails canonical/mirror per fixture ---
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "$*" >> "$DOCKER_CALLS"
case "$1" in
  pull)
    ref="$2"
    case "$ref" in
      mirror.gcr.io/*)
        [ "${MIRROR_OK:-0}" = "1" ] && { echo "$ref" >> "$DOCKER_PULLED"; exit 0; }
        echo 'Error response from daemon: Get "https://mirror.gcr.io/v2/": timeout' >&2
        exit 1 ;;
      *)
        [ "${CANONICAL_OK:-0}" = "1" ] && { echo "$ref" >> "$DOCKER_PULLED"; exit 0; }
        echo 'Error response from daemon: Get "https://registry-1.docker.io/v2/": timeout' >&2
        exit 1 ;;
    esac ;;
  tag)
    echo "tag $2 $3" >> "$DOCKER_TAGGED"; exit 0 ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$WORK/bin/docker"

PASS=0
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "  ok: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc"; FAIL=$((FAIL + 1)); fi
}

run_case() {
  local name="$1" canonical="$2" mirror="$3"
  export DOCKER_CALLS="$WORK/calls.$name"
  export DOCKER_PULLED="$WORK/pulled.$name"
  export DOCKER_TAGGED="$WORK/tagged.$name"
  : >"$DOCKER_CALLS"; : >"$DOCKER_PULLED"; : >"$DOCKER_TAGGED"
  set +e
  PATH="$WORK/bin:$PATH" \
    BUILDKIT_IMAGE="moby/buildkit:buildx-stable-1" \
    REGISTRY_MIRROR="mirror.gcr.io" \
    VERBOSE="false" \
    PREPULL_ATTEMPTS="2" PREPULL_DELAY="1" \
    CANONICAL_OK="$canonical" MIRROR_OK="$mirror" \
    bash "$WORK/prepull.sh" >"$WORK/out.$name" 2>&1
  echo $? >"$WORK/rc.$name"
  set -e
}

echo "== Case 1: canonical Docker Hub healthy =="
run_case canon 1 0
check "exits 0" test "$(cat "$WORK/rc.canon")" = "0"
check "pulled canonical image" grep -qx "moby/buildkit:buildx-stable-1" "$WORK/pulled.canon"
# The child bash expands its own positional argument.
# shellcheck disable=SC2016
check "did NOT touch the mirror" bash -c '! grep -q mirror.gcr.io "$1"' _ "$WORK/calls.canon"
check "did NOT need to tag" test ! -s "$WORK/tagged.canon"

echo "== Case 2: Docker Hub down, mirror healthy (issue #75 scenario) =="
run_case mirror 0 1
check "exits 0 (recovered via mirror)" test "$(cat "$WORK/rc.mirror")" = "0"
check "pulled from mirror" grep -qx "mirror.gcr.io/moby/buildkit:buildx-stable-1" "$WORK/pulled.mirror"
check "re-tagged mirror image to canonical ref" grep -qx \
  "tag mirror.gcr.io/moby/buildkit:buildx-stable-1 moby/buildkit:buildx-stable-1" "$WORK/tagged.mirror"

echo "== Case 3: both canonical and mirror down =="
run_case both 0 0
check "exits 0 (non-fatal fall-through)" test "$(cat "$WORK/rc.both")" = "0"
check "attempted the mirror before giving up" grep -q mirror.gcr.io "$WORK/calls.both"
check "warned about full failure" grep -q "could not pre-pull" "$WORK/out.both"

echo "== Static checks on action.yml =="
check "declares registry-mirror input" grep -q "registry-mirror:" "$ACTION"
check "defaults mirror to mirror.gcr.io" grep -q "default: 'mirror.gcr.io'" "$ACTION"
check "supports verbose tracing" grep -q "set -x" "$ACTION"
check "honours RUNNER_DEBUG" grep -q "RUNNER_DEBUG" "$ACTION"
check "pins boot driver image" grep -q "driver-opts: image=" "$ACTION"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "All issue #75 buildx mirror-fallback checks passed."
