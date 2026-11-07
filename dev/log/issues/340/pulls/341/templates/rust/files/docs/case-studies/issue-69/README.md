# Case Study: Issue #69 — Transient Docker Hub outage fails the buildx boot and takes the publish job down

## Summary

Issue [#69](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/69)
reports that `release.yml` booted buildx with `docker/setup-buildx-action@v4`
and **no pinned-image pre-pull**. The default `docker-container` driver makes
`dockerd` pull `moby/buildkit:buildx-stable-1` from Docker Hub at boot. When
`registry-1.docker.io` has a transient outage, that boot pull fails and takes
the whole publish job down — even though nothing is wrong with the code or the
build.

The failure surfaces at **Set up Docker Buildx → Creating a new builder
instance** with:

```
ERROR: Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)
```

This is the same class of failure investigated downstream in
[`link-foundation/box#100`](https://github.com/link-foundation/box/issues/100)
(a ~2.5-minute Docker Hub registry outage failed the buildx boot) and
originally [`link-foundation/box#97`](https://github.com/link-foundation/box/issues/97).

## Root cause

The `docker-container` buildx driver runs BuildKit inside a container. To start
it, `dockerd` must have the `moby/buildkit:buildx-stable-1` image locally; if it
does not, it pulls it from Docker Hub **at boot time**. There was no local copy
seeded before the boot and no retry/fallback around that pull, so any blip on
`registry-1.docker.io` that outlasts a single attempt fails the boot and, with
it, the entire `auto-release` / `manual-release` Docker publish step. The build
itself never even starts.

This is a pure infrastructure-availability failure: a transient third-party
registry outage is misreported as a release failure.

## Fix

Pre-pull the pinned BuildKit image **before** booting, with:

1. **Bounded retries with exponential backoff** against the canonical Docker Hub
   reference. This absorbs the common short blip.
2. **A pull-through registry-mirror fallback** (`mirror.gcr.io`, Google's public
   pull-through cache of Docker Hub, on independent infrastructure). When Docker
   Hub's registry endpoint is fully unreachable, retrying the canonical
   reference cannot recover no matter how many attempts — the mirror usually
   still serves the image.
3. **A re-tag to the canonical reference.** After a successful mirror pull, the
   image is `docker tag`-ed back to `moby/buildkit:buildx-stable-1` so the
   docker-container driver boot finds it locally and never touches the failing
   registry.
4. **Non-fatal fall-through.** If both the canonical registry and the mirror are
   down, the step emits a warning and lets `docker/setup-buildx-action` attempt
   its own boot pull — preserving the previous worst-case behaviour while making
   the common transient-failure case recover.
5. **A pinned boot driver image.** `driver-opts: image=moby/buildkit:buildx-stable-1`
   ensures the boot reuses exactly the reference that was seeded locally.

The logic is packaged as a reusable composite action,
[`.github/actions/setup-buildx-resilient`](../../../.github/actions/setup-buildx-resilient/action.yml),
ported from `link-foundation/box`'s `setup-buildx-resilient`. Both the
`auto-release` and `manual-release` jobs in `release.yml` now use it in place of
the bare `docker/setup-buildx-action@v4` step:

```yaml
- name: Set up Docker Buildx
  if: steps.dockerhub.outputs.enabled == 'true'
  uses: ./.github/actions/setup-buildx-resilient
```

Because it is a local composite action, the job's existing `actions/checkout`
step must run first (both jobs already check out at the top).

## Verification

`experiments/test-issue69-buildx-mirror-fallback.sh` extracts the real pre-pull
script from `action.yml` and drives it with a mock `docker` that can
independently fail the canonical registry and/or the mirror. It asserts:

| Scenario | Expected behaviour |
| --- | --- |
| Canonical Docker Hub healthy | Pulls canonical image, never touches the mirror, no re-tag, exits 0 |
| Docker Hub down, mirror healthy (the issue #69 scenario) | Pulls from `mirror.gcr.io`, re-tags to the canonical ref, exits 0 |
| Both canonical and mirror down | Attempts the mirror, warns, exits 0 (non-fatal fall-through) |

Plus static checks that `action.yml` declares the `registry-mirror` input,
defaults it to `mirror.gcr.io`, supports verbose tracing / `RUNNER_DEBUG`, and
pins the boot driver image.

Run it locally with:

```bash
bash experiments/test-issue69-buildx-mirror-fallback.sh
```

## References

- Upstream resilient action: [`link-foundation/box` `setup-buildx-resilient`](https://github.com/link-foundation/box/blob/main/.github/actions/setup-buildx-resilient/action.yml)
- Upstream case study: [`link-foundation/box` issue #100 CASE-STUDY](https://github.com/link-foundation/box/blob/main/docs/case-studies/issue-100/CASE-STUDY.md)
- `mirror.gcr.io` (Google Cloud's pull-through Docker Hub mirror)
