# Issue 287 investigation and component decisions

The investigation read the complete parent issue, its four native sub-issues,
all their comments and all three comment/review endpoints for PR 288. The
requirements and alternative approaches are inventoried in [plan.md](plan.md).
The immutable upstream baseline is
`7877a27980664bc6453e80262f8391d1c2562ab1`. Related downstream implementations
were inspected at sensitive-data-sanitizer PR 93 commit
`dedbee4a681487ec1051ac160816aa23617e7ffa` and PR 96 commit
`d4a80a5951095e092459a2eb0c96477b10f94921`; reusable helpers and tests were
adapted to this repository rather than introducing a new orchestration library.
Recent merged template PRs 282, 276, 274, 263 and 255 supplied repository context.

## Release integrity and push recovery (#283)

The reproducible client defect is treating GitHub's internal push rejection as
permanent or as a source race. The server's internal root cause is unknown.
Git already supplies the required primitives: unchanged ref updates are safe to
retry, `diff-tree` can attest changed paths and the parent, and
`merge-base --is-ancestor` can check remote publication without modifying the
checkout. Generic retry packages would add dependencies without implementing
these release-specific invariants. Existing `run-command`, push classification,
metadata attestation, version-lock comparison and explicit changeset-PR helpers
are retained and extended.

Retry only the reported internal failure and explicit HTTP 429/5xx, at most
three times with one/two second backoff. Authentication and rule failures take
precedence. Release pushes attest every attempt and cannot fall back to a PR or
rebase onto unvalidated code. Preview updates retain their existing recovery.

A validated SHA or a single metadata-only child with identical manifest/lock
content excluding versions may publish. Remote recovery first verifies those
same properties, then adopts the exact version. Publishing may fetch and check
ancestry but never pull source after validation. Ordinary same-version registry
self-healing and explicitly requested changeset PRs remain covered by existing
tests. Manual gates explicitly override skipped-needs behavior using a status
function, as described in [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).

## Dependency and workflow compatibility (#284)

The [minimatch advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)
and [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
motivate scoped overrides in all three package manifests/locks. Blanket major
replacement can break older callable APIs, so legacy dependency branches stay
unchanged. The existing real SDK archive probe and desktop ASAR probe exercise
the consumers; hosted artifact upload/download roundtrips remain the final CI
integration evidence. No replacement archive library is necessary.

[zizmor's self-repository audit](https://docs.zizmor.sh/audits/#self-repository)
conflicts with the repository's pinned actionlint 1.7.12 syntax support. The
baseline already contains the required narrow exceptions, including links,
security and workflows. Keep those exact filenames and add a drift gate that
compares every local action consumer with the exception list; other zizmor
audits and regular/pedantic passes remain active. Do not change local references
to syntax unsupported by the pinned validator.

[dependency-review-action](https://github.com/actions/dependency-review-action)
already supports visible OpenSSF scores with a warning threshold of zero;
retain its high-severity vulnerability failure threshold. npm's
[documented audit exit behavior](https://docs.npmjs.com/cli/v11/commands/npm-audit/#exit-code)
does not make arbitrary nonzero process results valid audit evidence. Validate
normal exits 0/1, the vulnerability map, advisory evidence and reference graph;
reject transport failures, dangling references and reference-only components.
The existing reporter supplies complete findings with the repository's high
failure threshold and scheduled policy for fixable moderate advisories. Temporary Git fixtures explicitly disable autocrlf; acceptance
assertions are unchanged.

## Preview container tools (#285)

The official [Playwright noble Dockerfile](https://github.com/microsoft/playwright/blob/v1.59.1/utils/docker/Dockerfile.noble)
is the image source, not a promise that arbitrary host tools are installed. Keep
the existing immutable Playwright digest and install the official
[GitHub CLI 2.103.3 release](https://github.com/cli/cli/releases/tag/v2.103.3)
archive with a fixed SHA256 before extraction. This avoids an extra package
repository, mutable apt result or unpinned setup action. A read-only PR job uses
the same image, checks all required tools and performs isolated dummy-token
credential setup/fill without contacting GitHub. The writer depends on that job;
the terminal gate and both path filters include it and its transitive helpers.
Tool-path diagnostics are opt-in.

## Report integrity (#286)

The lychee bug is a multiline whitespace match consuming the next failure
record. Horizontal whitespace and same-line descriptions fix that boundary;
shared section extraction excludes redirects while preserving supported timeout
and legacy fixtures. A Markdown parser would be a larger dependency for a small
stable report grammar.

[SARIF guidance](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support)
and the existing CodeQL action favor keeping the native result checker. Examine
both invocation notification arrays in every run, reject warning/error/default
warning and malformed evidence, allow note/none, and print descriptor, location
and message. A separate SARIF validator can check schema, but cannot replace the
repository policy that extraction/configuration warnings block a green scan.
Normal security findings continue to fail independently.

## Reproductions and verification

Run `node experiments/issue-287/reproduce.mjs --before` and `node experiments/issue-287/reproduce.mjs`. These offline
probes use an owned temporary tree and the immutable baseline to demonstrate
push retry, audit process, adjacent lychee and SARIF notification failures and
fixes. They perform no registry or repository writes. Real temporary-Git tests
cover publication races, local/remote metadata recovery, tracked source changes,
manifest/lock dependency drift and metadata staging. Focused tests exercise
workflow conditions, pinned installer/checksum failure, tool availability,
scorecard policy, dependency ranges and exception inventory.

Native JavaScript is the implementation; there are no incomplete ports,
unsupported translations, native adapters or Rust changes. Full platform,
container and hosted artifact checks are delegated to existing CI for the exact
candidate commit, avoiding duplicate resource-heavy local builds. Local logs
are kept outside tracked source; final CI links and results belong in PR 288.
