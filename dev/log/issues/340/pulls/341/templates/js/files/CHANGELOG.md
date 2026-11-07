# Changelog

## 0.11.31

### Patch Changes

- Fix every open CI correctness and resilience issue in the pipeline: scope the
  Docker buildx cache, retry transient fetch and download failures, make the
  budget wrapper escalate to SIGKILL, add a terminal status gate to every
  workflow with supersede detection, verify the husky install, make the jscpd
  gate analyse real files, guard the package manager declaration, turn on
  command-stream errexit, gate staged formatting before release commits, add
  release-preflight credential checks, and sweep zizmor/actionlint/persisted
  credentials/link-recheck fixes across the workflows.

  Allow protected releases to use the built-in GitHub Actions token after
  metadata-only attestation, wait through npm registry propagation without
  republishing, and skip deleted changesets during staged formatting checks.

  Make protected-branch release fallbacks wait for real pull-request checks with
  a dedicated automation token, and pin every Linux CI job to Ubuntu 24.04.

  Harden CI verdicts, Docker manifest publication, timeout cleanup, broken-link
  rechecks, and contributor-authored workflow logs, and refresh vulnerable
  transitive development dependencies.

## 0.11.30

### Patch Changes

- 8b129f9: Recognise npm's E409 "Cannot publish over previously staged version" wording as an already-published conflict in `publish-retry`, so a release that reached the registry verifies instead of failing the job.

## 0.11.29

### Patch Changes

- 0cd60b8: Bound the use-m CDN fetch with a per-attempt deadline and a retry, and report a load failure from the script that needs it.

  `loadUse()` fetched `https://unpkg.com/use-m/use.js` with a bare `fetch()`, so a CDN blip surfaced as `TypeError: fetch failed` — a message naming neither the CDN nor the URL — and a connection that was accepted but never answered was bounded only by undici's 300 s `headersTimeout`. Each attempt now carries a 15 s deadline enforced by an `AbortController`, a failed attempt is retried up to three times with exponential backoff (51 s worst case), and the final error names the URL, the attempt count and the underlying reason, keeping the original failure as its `cause`.

  The seven release scripts that loaded these modules at module scope now go through `scripts/bootstrap-dependencies.mjs`, which prints a GitHub `::error::` annotation and writes the fallback outputs the workflow reads — `published=false` for `publish-to-npm.mjs`, `version_committed=false` for `version-and-commit.mjs` — so a CDN outage no longer leaves a job with an empty `GITHUB_OUTPUT` and a loader stack.

## 0.11.28

### Patch Changes

- Configure the release and merge-simulation commit author as `41898282+github-actions[bot]@users.noreply.github.com` in `scripts/version-and-commit.mjs` and `scripts/simulate-fresh-merge.sh`, so those commits are attributed to the `github-actions[bot]` account and no longer require an extra approval under rulesets with `require_extra_approval_for_unattributed_changes`.

  Add a scheduled fail-closed high-severity audit for every committed npm lock.

  Ignore successful redirects when checking Lychee reports for broken links.

  Lint the workflows themselves: a new `workflows` check runs `actionlint` (from the Docker image that bundles shellcheck) and `zizmor`, and the findings they reported are fixed — the manifest digest list is built as an array, the packaging retry logs its attempt number, the npm wait passes the release version through the environment, and third-party actions are pinned to commit hashes.

  Fail the web archive check on lychee errors that have no http(s) URL

  `scripts/check-web-archive.mjs` only extracted `http(s)` links from the lychee
  report, so errors such as a missing local file or an unresolvable root-relative
  link were silently dropped. When those were the only errors the script printed
  "No broken URLs found" and set `all_archived=true`, masking a failing lychee
  run. The parser now matches the status marker instead of the URL and splits the
  results into archivable URLs and links the Wayback Machine cannot answer; the
  latter are annotated as errors and force `all_archived=false` with exit code 1.
  Adds regression tests over a captured lychee report fixture.

  Compare change detection paths package-relative so the ignore list (`examples/`, `.changeset/`, `experiments/`, `dev/log/`, `docs/case-studies/`) also matches in the multi-language layout, and stop reporting other languages' files as JavaScript code changes.

  Publish Docker images for both amd64 and arm64 using native runners and a multi-architecture manifest.

  Suppress the reviewed DEP0005 warning from the Docker manifest artifact download step.

  Land the release version bump through a pull request when a repository ruleset declines the direct push to `main`, and stop reporting a GH013 rule violation as a lost push race.

  Give long CI steps their own execution budget so an overrun reports `failure` instead of `cancelled`.

  Fail broken-link checks until archived replacements are applied to dead links.

  Load `command-stream` and `lino-arguments` through a shared use-m interop shim so the release scripts work on Node 24.

  Node 22.12+ adds a synthetic `module.exports` named export to CommonJS namespaces whose names cannot be inferred, which stops use-m from unwrapping the callable default. Destructuring `$` off the result therefore yields `undefined` and every release script fails with `TypeError: $ is not a function` on the Node 24 runners the workflows request. `scripts/use-module.mjs` normalises the namespace, reports the HTTP status when `use.js` cannot be fetched, names the observed keys when no callable export is found, and traces the resolved shape under `CI_SCRIPTS_DEBUG=1`.

  Report why `scripts/wait-for-npm.mjs` could not confirm a release. The check
  queries the npm registry over HTTP and returns `{ available, status, httpStatus,
url, error }`, so an HTTP 404 ("not published") is distinguished from an
  unanswered probe (5xx, rate limit, proxy, DNS). Every attempt logs its outcome,
  and an unanswered probe no longer claims the version "did not become available
  on npm" — it says the publish status is unknown and points at the registry URL
  to check. The step also exposes an `npm_check_status` output.

## 0.11.27

### Patch Changes

- 53519f1: Report release pipeline timeout cancellations as visible failures on the default branch.

## 0.11.26

### Patch Changes

- 328d858: Add CodeQL analysis for JavaScript and GitHub Actions plus high-severity dependency review for pull requests.

## 0.11.25

### Patch Changes

- 8af8547: Require successful lint and test quality gates before manual releases can publish.

## 0.11.24

### Patch Changes

- dd8a969: Reject unsupported keys in generated workflow concurrency blocks.

## 0.11.23

### Patch Changes

- e73716a: Harden workflow inputs, checkout configuration, and deployment concurrency.

## 0.11.22

### Patch Changes

- d0b42fa: Keep excluded-directory changes from activating change-gated CI jobs on pull
  requests and direct pushes.

## 0.11.21

### Patch Changes

- 5bf9619: Quote the fresh merge base ref to prevent shell word splitting.

## 0.11.20

### Patch Changes

- dfd681f: Report ESLint warnings only on lines changed relative to the base branch, so unchanged findings such as `local/no-changelog-comments` stop repeating on every run. Errors are still reported for all files.

## 0.11.19

### Patch Changes

- 8608672: Split publish and verification failure domains in `publish-to-npm.mjs`: verification now polls the npm registry with exponential backoff, and a verification miss no longer re-runs `changeset publish`.

## 0.11.18

### Patch Changes

- 6b3289a: Build the Dockerfile on pull requests via a new `docker-build` job, so a broken image fails the pull request instead of only surfacing after the package is published. The build uses `push: false` with `load: true` (works for fork pull requests, which have no registry credentials) and the GHA layer cache. Repositories without a Dockerfile skip the job automatically.

## 0.11.17

### Patch Changes

- ebaa52a: Add a least-privilege top-level `permissions: contents: read` block to `release.yml` and `links.yml` so jobs no longer inherit the repository default `GITHUB_TOKEN` scope, with write access escalated only on the publishing jobs.

## 0.11.16

### Patch Changes

- 1349837: Suppress the Git default-branch hint during release workflow checkout.

## 0.11.15

### Patch Changes

- f04c820: Quiet release logs by checking npm package versions through the registry HTTP API and removing deprecated setup-node `always-auth` config before publish-job npm commands run.

## 0.11.14

### Patch Changes

- 63b31c3: Harden generated preview-image pushes against main branch non-fast-forward races.

## 0.11.13

### Patch Changes

- Add a warning-level ESLint rule for changelog-style comments and strings.

  Detect code changes from real merge commits pushed to main with the first-parent
  merge diff while preserving pull request synthetic merge behavior.

## 0.11.12

### Patch Changes

- 89fb151: Ignore stray Markdown files when checking for pending changesets.

## 0.11.11

### Patch Changes

- d2e3932: Require exact changelog version headers when extracting GitHub release notes.
- e7356e9: Fail release-time changeset merging when any pending changeset is malformed.

## 0.11.10

### Patch Changes

- 9915756: Auto-detect single-language versus `js/` monorepo layouts when naming GitHub
  releases, namespace multi-language JavaScript tags as `js_v<version>`, and
  normalize prefixed tags before linking npm version badges.

## 0.11.9

### Patch Changes

- 49a8205: Add a post-publish smoke test that installs the just-published npm package in a clean project and verifies its entry points.

## 0.11.8

### Patch Changes

- 391530e: Skip the slow CI test matrix for pull requests that only touch non-code files.

## 0.11.7

### Patch Changes

- 674f9ce: Fix npm release path for brand-new packages (issue #77):
  - `publish-to-npm.mjs` now classifies authentication / registry-configuration
    failures (404/401/403, `access token expired`, `ENEEDAUTH`, etc.) as
    non-retryable and fails fast with actionable guidance instead of retrying
    `MAX_RETRIES` times and hiding the real cause behind a generic error.
  - The `release` and `instant-release` publish steps now pass an optional
    `NODE_AUTH_TOKEN` sourced from `secrets.NPM_TOKEN`, providing a first-publish
    bootstrap path. OIDC trusted publishing remains the steady-state mechanism;
    the token is only needed for the very first release of a new package.

## 0.11.6

### Patch Changes

- 8ca3e32: Harden the `publish-dockerhub` buildx boot against transient Docker Hub registry outages. A new reusable `setup-buildx-resilient` composite action pre-pulls the pinned `moby/buildkit` image with retries and a `mirror.gcr.io` pull-through fallback, then boots buildx with the driver image pinned to the locally cached copy so a `registry-1.docker.io` blip no longer fails the publish job (issue #75).

## 0.11.5

### Patch Changes

- 312a2fe: Add a `concurrency` block to the Broken Link Checker workflow (`links.yml`) so redundant runs are cancelled on new commits, consistent with the other workflows in the template.

## 0.11.4

### Patch Changes

- 35696cc: Cap generated GitHub release notes before creating releases so oversized changelog
  entries link to the full tagged changelog instead of failing GitHub API
  validation.

## 0.11.3

### Patch Changes

- a8e4030: Run the preview screenshot regeneration workflow inside the official Playwright container to avoid stalled Chromium downloads in CI, and keep the desktop packaging job on Node 20 while verifying package output before artifact upload.

## 0.11.2

### Patch Changes

- aeec4cb: Enforce the 1500-line architecture limit across all JavaScript (`.js`, `.mjs`, `.cjs`) and Markdown (`.md`) files in the `check-file-line-limits` CI gate, lower the documentation limit from 2500 to 1500, and exempt case-study generated-data files explicitly.

## 0.11.1

### Patch Changes

- 8cd0d70: Correct CI workflow concurrency and preview failure artifact handling in the template.

## 0.11.0

### Minor Changes

- e7025ed: Add a release-time `preview-regen` job to `example-app.yml` and a
  `scripts/update-preview-images.mjs` driver that boot the universal example app
  in a headless Chromium via `browser-commander` + Playwright, capture a
  locale × theme matrix of screenshots into `docs/screenshots/example-app/`, and
  commit any drift back to `main` with `[skip ci]`. Adds the matching
  `npm run example:web:preview-images` script.

## 0.10.2

### Patch Changes

- f044604: Document the one-time **Settings → Pages → Source = GitHub Actions** prerequisite for the example app deployment, and note it in a comment above the `pages-deploy` job.

## 0.10.1

### Patch Changes

- ede9f84: Publish the template as the real link-foundation example package and add the globally installable CLI entry point.

## 0.10.0

### Minor Changes

- 5a81a7f: Add a universal React example app with GitHub Pages, Electron desktop, and Capacitor mobile build paths.

## 0.9.0

### Minor Changes

- f23283c: Add an optional Docker Hub publishing path that waits for the exact npm
  package version before tagging Docker images.

## 0.8.6

### Patch Changes

- acccf75: Format GitHub release names as human-readable `[Language] x.y.z` titles while keeping prefixed tag names unchanged.

## 0.8.5

### Patch Changes

- Fail GitHub release creation on unexpected gh api errors and clearly skip releases that already exist.

  Enforce npm and Node.js minimum versions for trusted publishing setup and resolve a supported npm 11 tarball for fallback installs.

## 0.8.4

### Patch Changes

- 031f7cd: Add explicit CI job timeouts and per-test runner timeout limits.

## 0.8.3

### Patch Changes

- bdaa4b7: Derive release script package names from package.json instead of template placeholders.

## 0.8.2

### Patch Changes

- d179bb7: Add warning annotations for files approaching the CI file line limit.

## 0.8.1

### Patch Changes

- f0c69af: Normalize language-prefixed release tags before building npm shields.io badge URLs.

## 0.8.0

### Minor Changes

- 3e45a9c: Add `--tag-prefix` option to release scripts for multi-language repos

  The `create-github-release.mjs` and `format-github-release.mjs` scripts now accept a `--tag-prefix` CLI parameter (defaulting to `v`) that allows users to customize the git tag prefix. This enables use in multi-language repositories where different language packages need distinct tag prefixes (e.g., `js-v1.0.0` vs `rust-v1.0.0`).

## 0.7.3

### Patch Changes

- ae2cc9a: Add self-healing release mechanism that checks npm registry for unpublished versions

## 0.7.2

### Patch Changes

- 9126e16: fix: npm upgrade fallbacks and Node.js 24.x upgrade for CI/CD
  - Upgrade Node.js from 20.x to 24.x in all workflow files (avoids broken npm in Node.js 22.22.2)
  - Add 4-strategy fallback chain to setup-npm.mjs (standard, curl tarball, npx, corepack)
  - Update GitHub Actions to latest versions (checkout v6, setup-node v6, create-pull-request v8)
  - Add case study documentation for issue #33

## 0.7.1

### Patch Changes

- 6916409: Use per-commit diff instead of full-PR diff for CI change detection

## 0.7.0

### Minor Changes

- 983789a: Add CI/CD best practices from hive-mind: fast-fail job ordering, test compilation, file line limits check, secrets detection, documentation validation, extracted fresh merge simulation script, and proper cancellation propagation

## 0.6.0

### Minor Changes

- 8961862: Add automated broken link checker with Web Archive fallback suggestions
  - Add `.github/workflows/links.yml` with lychee-action for link checking in Markdown and HTML files
  - Add `scripts/check-web-archive.mjs` to check broken links against the Wayback Machine API
  - Add `.lycheeignore` for excluding known false-positive URLs (localhost, example.com, etc.)
  - Update `README.md` to document the broken link checker feature
  - Scheduled weekly check (Mondays at 09:00 UTC) to catch links that break over time
  - On PRs, broken links with no Web Archive fallback will fail the check
  - For broken links that have archived versions, provides actionable replacement suggestions
  - On scheduled runs, automatically creates a GitHub Issue with the full broken links report

  Fixes #27

## 0.5.1

### Patch Changes

- e398190: Add comprehensive best practices comparison and improve CI concurrency
  - Add DETAILED-COMPARISON.md with side-by-side analysis of ALL scripts, workflows, and configurations
  - Implement cancel-in-progress for main branch concurrency (hive-mind Issue #1274 fix)
  - Fix max-lines documentation (1500, not 1000)
  - Reference detailed comparison from BEST-PRACTICES.md

## 0.5.0

### Minor Changes

- 66211b5: Add fresh merge simulation to CI/CD to prevent stale merge preview issues
  - Add "Simulate fresh merge with base branch" step to lint and test jobs
  - This ensures PR CI validates the actual merge result, not a stale snapshot
  - Prevents CI failures on main branch after merging PRs that sat open for days
  - Add case study documentation for issue #23 with root cause analysis
  - Add ignore patterns for case study data files in ESLint and Prettier

  See docs/case-studies/issue-23 for detailed analysis of the stale merge preview problem.

  Fixes #23

## 0.4.0

### Minor Changes

- e6c2691: Add multi-language repository support for CI/CD scripts
  - Add `scripts/js-paths.mjs` utility for automatic JavaScript package root detection
  - Support both `./package.json` (single-language) and `./js/package.json` (multi-language repos)
  - Add `--legacy-peer-deps` flag to npm install commands in release scripts to fix ERESOLVE errors
  - Save and restore working directory after `cd` commands to fix `command-stream` library's `process.chdir()` behavior
  - Add case study documentation with root cause analysis in `docs/case-studies/issue-21/`

## 0.3.0

### Minor Changes

- 80d9c84: Add CI check to prevent manual version modification in package.json
  - Added `check-version.mjs` script that detects manual version changes in PRs
  - Added `check-changesets.mjs` script to check for pending changesets (converted from inline shell)
  - Added `version-check` job to release.yml workflow
  - Automated release PRs (changeset-release/_ and changeset-manual-release-_) are automatically skipped

## 0.2.2

### Patch Changes

- 9a12139: Fix CI/CD check differences between pull request and push events

  Changes:
  - Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
  - Make lint job independent of changeset-check (runs based on file changes only)
  - Allow docs-only PRs without changeset requirement
  - Handle changeset-check 'skipped' state in dependent jobs
  - Exclude `.changeset/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

## 0.2.1

### Patch Changes

- 55aef41: Make Bun the primary runtime choice throughout the template
  - Update all shebangs from `#!/usr/bin/env node` to `#!/usr/bin/env bun` in scripts, experiments, and case studies
  - Update README.md to prioritize Bun in all sections (features, development, runtime support, package managers, scripts reference)
  - Update examples to list Bun first
  - Bun now described as "Primary runtime with highest performance" and "Primary choice" for package management
  - Maintains full compatibility with Node.js and Deno

## 0.2.0

### Minor Changes

- d3f7fcd: Improve changeset CI/CD robustness for concurrent PRs
  - Update validate-changeset.mjs to only check changesets ADDED by the current PR (not pre-existing ones)
  - Add merge-changesets.mjs script to combine multiple pending changesets during release
  - Merged changesets use highest version bump type (major > minor > patch) and combine descriptions chronologically
  - Update release workflow to pass SHA environment variables and add merge step
  - Add comprehensive case study documentation for the CI/CD improvement
  - This prevents PR failures when multiple PRs merge before a release cycle completes

## 0.1.4

### Patch Changes

- e9703b9: Add ESLint complexity rules with reasonable thresholds

## 0.1.3

### Patch Changes

- 0198aaa: Add case study documentation comparing best practices from effect-template

  This changeset adds comprehensive documentation analyzing best practices from
  ProverCoderAI/effect-template repository, identifying gaps in our current setup,
  and providing prioritized recommendations for improvements.

  Key findings include missing best practices like code duplication detection (jscpd),
  ESLint complexity rules, VS Code settings, and test coverage thresholds.

## 0.1.2

### Patch Changes

- 2ea9b78: Enforce strict no-unused-vars ESLint rule without exceptions. All unused variables, arguments, and caught errors must now be removed or used. The `_` prefix no longer suppresses unused variable warnings.

## 0.1.1

### Patch Changes

- 042e877: Fix GitHub release formatting to support Major/Minor/Patch changes

  The release formatting script now correctly handles all changeset types (Major, Minor, Patch) instead of only Patch changes. This ensures that:
  - Section headers are removed from release notes
  - PR detection works for all release types
  - NPM badges are added correctly

## 0.1.0

### Minor Changes

- 65d76dc: Initial template setup with complete AI-driven development pipeline

  Features:
  - Multi-runtime support for Node.js, Bun, and Deno
  - Universal testing with test-anywhere framework
  - Automated release workflow with changesets
  - GitHub Actions CI/CD pipeline with 9 test combinations
  - Code quality tools: ESLint + Prettier with Husky pre-commit hooks
  - Package manager agnostic design

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
