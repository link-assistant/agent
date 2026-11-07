# Issue 212: repository-wide pipeline repairs

This work addresses issues 205–211 in PR 213, as required by parent issue 212.
All eight issue descriptions and their comments were read before implementation;
none had comments at the start of the investigation.

## Work plan

- [x] Verify the prepared branch and clean initial working tree.
- [x] Read the parent issue, every sub-issue, and all PR comment types.
- [x] Inspect contributing instructions, related recent PRs, and every affected path.
- [x] Research primary documentation and existing components for each repair.
- [x] List every requirement, alternatives, and the chosen implementation below.
- [x] Preserve failed CI logs, verify timestamps and commit IDs, and trace failures.
- [x] Add minimal regressions and demonstrate failures before each implementation.
- [x] Repair version and changeset guards throughout the release pipeline.
- [x] Verify npm OIDC through the package-specific token exchange.
- [x] Repair release badge detection and exact Git commit-message handling.
- [x] Repair survivor formatting and remove the SIGTERM fixture's busy loop.
- [x] Align zizmor versions, pin secretlint, and enforce workflow policy.
- [x] Repair missing GitHub releases, scope CodeQL, and pin hosted runner images.
- [x] Add a patch changeset as the automatic release trigger.
- [x] Run the full test suite and local contributing checks before commits/pushes.

Submission acceptance is tracked in [PR 213](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/213):
review the complete diff, retain current main and forward-moving history, update
the title and all closing references, push only the prepared branch, inspect CI
at the exact submitted SHA, and mark the PR ready after all checks pass.

## Requirements and solution analysis

The following sections record the detailed requirement audit, research, selected
solutions, and validation evidence as implementation proceeds.

### Complete requirement inventory and selected plans

| Source            | Requirement                                                              | Alternatives and selected solution                                                                                                                | Verification                                                                                  |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| #212              | Read every listed issue and all comments                                 | Fetch each issue and paginate comments; also read conversation, review comments, and reviews on PR 213                                            | Eight issues read; no comments initially                                                      |
| #212              | Resolve all seven issues in this single PR, without deferral             | One branch with atomic commits and one patch changeset                                                                                            | PR diff and closing-reference audit                                                           |
| #212              | Close the parent and every child with a separate keyword                 | Use the required seven-line block verbatim and add `Fixes #212`                                                                                   | PR body inspection                                                                            |
| #212              | Identify any already resolved or unreproducible issues explicitly        | Reproduce each failure before fixing; no listed issue is already resolved                                                                         | Before/after regression logs                                                                  |
| #205              | Unchanged JSON formatting must pass                                      | Text diff matching is brittle; parse committed manifest values instead                                                                            | Reindented and reordered manifest fixture                                                     |
| #205              | Actual manual version changes must fail                                  | Compare `.version` at merge base and PR head                                                                                                      | Changed version fixture                                                                       |
| #205              | Missing base refs and all Git/JSON failures must fail                    | Do not convert command errors into empty diffs; resolve refs before comparing                                                                     | Missing ref, invalid JSON, absent/non-string version fixtures                                 |
| #205              | Argument-array Git execution and merge-base comparison                   | Use Node `execFileSync` and a shared comparison helper, without invoking a shell                                                                  | Divergent-history fixture and metacharacter ref                                               |
| #205              | Reject branch-name-only bypasses                                         | Remove exemptions entirely, or verify release identity; chosen: same-repository release PR from the configured actor                              | Impersonated branch, fork, genuine bot, and configured actor cases                            |
| #206              | Failed CI comparison cannot accept an existing base fragment             | Reject unavailable comparisons; never retry with directory scanning in CI                                                                         | Existing-fragment/missing-base fixture                                                        |
| #206              | Directory fallback is explicit local use only                            | `ALLOW_LOCAL_CHANGESET_SCAN=true`, forbidden with CI/Actions context                                                                              | Local opt-in and CI rejection                                                                 |
| #206              | Compare the merge base and count added fragments only                    | NUL-delimited `--name-status --no-renames`; only `A` records qualify                                                                              | Added, modified, multiple, and base-only fragments                                            |
| #206              | Make documentation-only exemption policy explicit                        | Preserve contributing policy: Markdown, docs, examples, experiments, development logs, and other-language package paths do not require a fragment | Documentation-only fixture, multi-language paths                                              |
| #206              | Preserve exactly-one valid-fragment validation                           | Require anchored frontmatter and a nonempty description                                                                                           | Multiple and malformed fragment cases                                                         |
| #207              | An OIDC environment variable is insufficient proof                       | Request GitHub JWT with audience `npm:registry.npmjs.org`, then perform package-specific npm exchange                                             | Stub records both HTTP calls                                                                  |
| #207              | Use URL-escaped package name and package exchange endpoint               | Reuse package/path detection and `encodeURIComponent`; POST the documented endpoint                                                               | Scoped package URL asserted                                                                   |
| #207              | Reject HTTP/network/malformed exchange responses                         | Distinguish denied from unknown; both prevent release until all targets verify                                                                    | 401/403/404/429/500/network and malformed body fixtures                                       |
| #207              | Require every configured target independently                            | Refuse release with any failed or unknown target; report mode remains advisory                                                                    | Docker success plus npm denial/unknown; Docker throttling                                     |
| #207              | Discard exchange token without logging it                                | Validate a nonempty token and redirect its parser output to `/dev/null`; do not print response bodies                                             | Assert fixture JWT/token never appear in output                                               |
| Existing behavior | Retain first-publication token bootstrap                                 | npm exchange 404 plus configured `NPM_TOKEN` checks the documented bootstrap fallback; other exchange failures remain blocking                    | Bootstrap and expired-token fixtures                                                          |
| #208              | Skip formatting only for generated npm badge images                      | A custom marker would change existing notes; instead extract Markdown image destinations and parse URLs                                           | Actual generated badge plus deceptive inputs                                                  |
| #208              | Exact HTTPS hostname and `/badge/npm-` path                              | Reject mentions, suffix hosts, URL userinfo, path-embedded hostnames, HTTP, plain URLs, and unrelated badges                                      | Badge predicate tests                                                                         |
| #208              | Preserve exact commit messages without partial shell escaping            | Use existing argument-array `runStrict` instead of manually escaping double quotes                                                                | Actual temporary Git commit with quotes, backslash, dollar sign, substitutions, and backticks |
| #209              | Put survivor records on separate actual lines                            | Correct the awk string's newline escape                                                                                                           | Actual process group with two finite sleep children                                           |
| #209              | Stop the SIGTERM test child busy-looping while preserving escalation     | Replace EOF `read` with `sleep 1 & wait $!`; a trapped TERM interrupts wait and continues                                                         | Existing escalation test asserts trap output and no survivors                                 |
| #210              | Use one zizmor version in both passes and reproduction comment           | Downgrade second pass, or upgrade supported action; chosen v0.6.4 and 1.30.1 throughout                                                           | Version equality and supported-action policy                                                  |
| #210              | Action must support the selected analyzer version                        | Verify v0.6.4's upstream digest table; record the supported pin in policy                                                                         | Offline policy rejects unknown action/version                                                 |
| #210              | Pin secretlint and recommended preset to the same version                | CLI exact pins avoid adding unrelated runtime dependencies                                                                                        | Both pinned to 13.0.7                                                                         |
| #210              | Prevent unpinned `npx -p` packages recurring                             | Add a CI policy guard across active workflows/composite actions                                                                                   | Unscoped/scoped, multiple, continued, and long-option tests                                   |
| #210              | Confirm secretlint really scans                                          | Invoke pinned scanner against clean and synthetic GitHub/Slack token fixtures                                                                     | Reusable scanner experiment                                                                   |
| #211              | Repair npm-published versions lacking a GitHub release                   | Extend existing gate rather than introduce a second release workflow; missing release yields `should_release=true`, `skip_bump=true`              | Offline HTTP CLI fixture                                                                      |
| #211              | Use GitHub releases, not tags alone, and match naming                    | Query `/releases/tags/<encoded tag>` built with existing naming helper                                                                            | Root `v` and language-prefixed `js_v` fixtures                                                |
| #211              | Only 404 means missing; errors mean unknown and must not release         | A tri-state lookup with a bounded request, response validation, and no redirects                                                                  | 401/403/429/500, malformed, network cases                                                     |
| #211              | Preserve unpublished-version recovery and normal changeset releases      | Retain existing npm check and version-bump decision                                                                                               | npm 404 and pending-changeset fixtures                                                        |
| #211              | Exclude experimental/example files from CodeQL                           | A custom configuration with `paths-ignore`; keep source, tests, and pipeline scripts scanned                                                      | Configuration wired into CodeQL init                                                          |
| #211              | Pin macOS/Windows labels everywhere and prevent recurrence               | Use supported `macos-15` and `windows-2025`, retain `ubuntu-24.04`                                                                                | All active workflow/matrix labels and policy mutation tests                                   |
| User workflow     | All tests/checks, release trigger, clean history, current main, ready PR | Patch changeset instead of manual version bump; forward commits; preserve CI logs and verify exact SHAs                                           | Final local and remote validation                                                             |

A scheduled historical release audit was suggested as an additional option in
#211, rather than a required repair. The chosen gate fixes the current version on
the next qualifying main push. Historical backfill is outside the described
current-version reproduction; no publication or release is performed by tests.

### Primary-source research and existing components

- [Git merge-base](https://git-scm.com/docs/git-merge-base) defines the common
  ancestor for comparison. Comparing current base directly with head can count
  files that were removed only on the base's divergent branch.
- [Node child processes](https://nodejs.org/api/child_process.html) provide
  argument-array execution without a shell. The repository already has
  `runStrict`; it is reused for the Git commit instead of adding an execution
  library.
- [Changesets](https://github.com/changesets/changesets) already manages this
  package's version and changelog. Its CLI is retained; a small PR-diff guard
  enforces the repository's exactly-one-fragment policy before release.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and the
  [npm Registry API](https://api-docs.npmjs.com/) document the audience,
  package-scoped exchange, and short-lived returned token. `npm whoami` does not
  validate trusted-publisher permission. The existing Bash/curl preflight uses
  this exchange directly, avoiding a new SDK and any package publication.
- [GitHub Releases REST API](https://docs.github.com/en/rest/releases/releases)
  distinguishes a release lookup by tag from a bare Git tag. Built-in `fetch`
  is sufficient; [Octokit](https://github.com/octokit/rest.js) would add a
  dependency for one GET request.
- [zizmor-action v0.6.4's supported digest table](https://github.com/zizmorcore/zizmor-action/blob/v0.6.4/support/versions)
  was fetched through the authenticated GitHub contents API. Its newest entry
  is 1.30.1; v0.6.2 stops at 1.29.0. Both passes retain their existing personas.
- [Secretlint](https://github.com/secretlint/secretlint) supplies the existing
  credential scanner and recommended rules; exact CLI package versions are
  sufficient to meet the requested reproducibility policy.
- [CodeQL configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options)
  supports a custom configuration passed to `init`, including excluded paths
  for interpreted languages. This is used for experimental and example code.
- [GitHub runner images](https://github.com/actions/runner-images) lists the
  explicit `macos-15` and `windows-2025` labels. Pinning a label keeps OS major
  migrations explicit while allowing image maintenance updates.
- A Markdown parser such as [remark](https://github.com/remarkjs/remark) could
  parse all Markdown constructs, but generated badges use a small inline image
  form. A bounded image-destination recognizer plus standard URL parsing covers
  that format without a new parser dependency.

Related work inspected: merged PRs 200 and 204 (protected releases, npm
verification, staged formatting, runtime/dependency pins). Their behavior and
regressions remain in place. The upstream examples linked from each issue were
considered; this implementation follows this repository's existing package-path,
release-naming, process-runner, and test-anywhere conventions.

### Codebase coverage

Active scripts, tests, experiments, all five workflows, and both composite
Actions were searched for the affected patterns. Version/changeset validation
share comparison and release-identity rules; both workflow branch-name bypasses
are removed. Badge skipping has one active call site. Both Node/Bun test paths
share the corrected SIGTERM fixture. The secretlint invocation and every
macOS/Windows runner matrix/direct label are updated. CodeQL receives the same
configuration in both language matrix legs. Release repair uses the same naming
helper as release creation, including multi-language repositories.

Historical case-study snapshots and preserved CI logs are research evidence;
they are not executable release guards and are intentionally not rewritten.

### Reproduction and local verification

`node experiments/issue-212-regressions.mjs` archives the actual pre-fix main
commit `4c8644fb457b65933fcb19b033e60e7d0338f2ad`, copies the current regressions,
and runs them against that isolated snapshot. It reproduces failures for every
listed issue: 56 failing assertions out of 113 tests. Some new assertions also
fail because the old implementation lacks the new helpers/configuration;
the original formatting, missing-ref, existing-fragment, denied-exchange,
commit-message, survivor-output, release-recovery, and workflow-version defects
all have direct behavioral or policy failures in the same run. No issue was
already resolved or unreproducible. The SIGTERM fixture's CPU spin was traced to
the immediate EOF read, and its escalation test passes with the blocking wait.

Captured [pre-fix regression output](validation/baseline-regressions.log.gz) and
[Node](validation/node-tests.log.gz), [Bun](validation/bun-tests.log.gz), and
[Deno](validation/deno-tests.log.gz) output preserve the evidence.

| Check                                                                          | Result                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `npm test`                                                                     | 559 passed, zero failed                                             |
| `bun test --timeout 30000`                                                     | 559 passed, zero failed                                             |
| `deno test --allow-read`                                                       | 414 applicable tests passed, zero failed                            |
| `npm run check`                                                                | ESLint, Prettier, and duplication check passed                      |
| Syntax, file line limits, required docs, workflow policy, status-gate coverage | Passed                                                              |
| actionlint 1.7.12; zizmor 1.30.1 regular and filtered pedantic passes          | Passed; no findings                                                 |
| Pinned secretlint full-tree scan                                               | Exit 0                                                              |
| `node experiments/issue-212-secretlint.mjs`                                    | Clean fixture exit 0; synthetic GitHub and Slack tokens each exit 1 |
| Root and example `npm audit --package-lock-only --audit-level=high`            | Both passed                                                         |
| Example app `npm ci --ignore-scripts` and `npm run build`                      | Passed                                                              |

Deno can rebuild the shared `node_modules` directory. Local runtime suites
therefore need separate dependency directories or sequential installs/runs.
An initial concurrent Bun run failed four ESLint-rule tests with a missing
`find-up` dependency; a fresh `npm ci` followed by a sequential Bun run passed.
GitHub's runtime matrix uses separate jobs/directories and avoids that race.

### Initial CI investigation and additional necessary repair

The initial Security run [37555257997](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37555257997)
was created at `2026-10-07T01:04:28Z`, after prepared commit
`15deba648c58bb920948ac2b4b3c3785d8e284e4` at `01:04:16Z`, with that exact head SHA.
Checks and release run 37555258148 passed at the same SHA. The Security failure
was reproduced locally from the example lockfile and downloaded to
`ci-logs/security-37555257997.log`; its [compressed copy](validation/security-37555257997.log.gz)
is preserved here.

- Lines 2257 and 2263 report critical Capacitor Android/iOS vulnerabilities:
  [GHSA-rvm3-566m-v7fv](https://github.com/advisories/GHSA-rvm3-566m-v7fv).
- Line 2269 reports the high-severity source-map-js vulnerability:
  [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

A compatible lockfile refresh updates Capacitor Android/iOS from 7.6.4 to 7.6.9
and source-map-js from 1.2.1 to 1.2.2, along with compatible dependency resolution.
The manifests retain their ranges and both configured high-severity audits pass.
Eight pre-existing moderate findings remain in the electron-builder dependency
chain; npm's proposed forced fix is a breaking downgrade, so it is outside this
repair. The example production build also passes with the refreshed lock.

### Windows regression-test correction

Checks and release run [37557125805](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37557125805)
was created at `2026-10-07T01:26:41Z`, after submitted commit
`0c2fb3b3031b4ba5d6d4f6495d08c44ffae69e56` at `01:26:27Z`, with that exact SHA.
The other four workflows and seven runtime/OS legs passed. Both Windows Node
and Bun legs failed in the commit-message regression's source matcher because
Git checked out CRLF source files. The downloaded
`ci-logs/checks-and-release-37557125805.log` records the null-match error at
lines 10185 and 11808; its [compressed copy](validation/checks-and-release-37557125805.log.gz)
is preserved here.

The test now exercises both LF and CRLF source files and accepts either ending
when locating the production commit block. The explicit CRLF case first failed
locally with the same error, then both cases passed under Node and Bun. The
release implementation remains unchanged. [Before](validation/commit-message-crlf-before.log.gz)
and [after](validation/commit-message-crlf-after.log.gz) logs preserve the reproduction.
