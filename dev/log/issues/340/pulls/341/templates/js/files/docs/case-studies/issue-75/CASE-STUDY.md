# Issue #75 — Resilient buildx boot for `publish-dockerhub`

## Symptom

Release runs that publish the Docker image occasionally failed at
**Set up Docker Buildx → Creating a new builder instance** with:

```
ERROR: Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)
```

Nothing was wrong with the code or the build — a transient Docker Hub registry
outage took the whole publish job down.

## Root cause

The `publish-dockerhub` composite action booted buildx with
`docker/setup-buildx-action@v4` and no pinned-image pre-pull. The default
`docker-container` driver makes dockerd pull `moby/buildkit:buildx-stable-1`
straight from Docker Hub at boot. When `registry-1.docker.io` is unreachable for
longer than a normal blip, that single boot pull fails and there is no retry or
alternative source — so the job fails.

This is the same class of failure investigated upstream in
`link-foundation/box` issues #97 and #100 (a ~2.5-minute Docker Hub registry
outage failed the buildx boot).

## Fix

A reusable composite action, `.github/actions/setup-buildx-resilient`, seeds the
pinned BuildKit image locally **before** booting buildx:

1. **Pre-pull with retries + exponential backoff** from canonical Docker Hub.
   The common transient-blip case recovers here.
2. **Registry-mirror fallback.** When Docker Hub's registry endpoint is fully
   unreachable, pull `mirror.gcr.io/moby/buildkit:buildx-stable-1` (Google's
   public pull-through cache of Docker Hub, on independent infrastructure) and
   re-tag it to the canonical reference.
3. **Boot buildx with the driver image pinned** (`driver-opts: image=…`) so the
   `docker-container` driver reuses the locally cached image and never touches
   the failing registry.

If both the registry and the mirror are down, the step is **non-fatal**: it logs
a warning and falls through to `setup-buildx-action`, which attempts its own boot
pull — preserving the previous worst-case behaviour while making the common
transient-failure case recover.

`publish-dockerhub/action.yml` now calls `setup-buildx-resilient` instead of
`docker/setup-buildx-action@v4` directly.

## Verification

- `tests/setup-buildx-resilient.test.js` extracts the real pre-pull `run:` block
  from the action and drives it with a mock `docker`, asserting recovery for the
  healthy-registry, registry-down/mirror-up, and both-down cases.
- `experiments/test-issue75-buildx-mirror-fallback.sh` is the standalone
  offline reproduction of the same scenarios.

## References

- Upstream: `link-foundation/box` issues #97 and #100, action
  `.github/actions/setup-buildx-resilient/action.yml`.
