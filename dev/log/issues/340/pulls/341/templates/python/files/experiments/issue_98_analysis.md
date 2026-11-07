# Issue 98: requirements, research and verification

Scope: [#98](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/98)
requires [#94](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/94),
[#95](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/95)
and [#96](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/96)
in [PR #99](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/pull/99).
All four issue descriptions and comments were read. All issue comments and the
three PR comment types were empty at initial investigation. No listed issue was
already resolved.

## Every requirement and its solution plan

| Requirement | Possible solutions | Selected solution and verification |
| --- | --- | --- |
| #98: Read every listed issue, including comments. | Read issue views and paginated comment APIs. | Read #94/#95/#96/#98 and paginated issue/PR discussion, review comments and reviews before implementation. |
| #98: Implement every listed issue in one PR; no follow-ups. | Separate fixes in one branch, or one coordinated implementation. | All changes use the prepared branch and PR #99; inspect the entire final diff. |
| #98: Close parent and every sub-issue in the PR description. | Separate full closing statements. | Include `Fixes #94`, `Fixes #95`, `Fixes #96`, `Fixes #98`, each on its own line. |
| #98: Explain already-resolved or irreproducible issues but keep closing references. | State evidence for each exception. | All three defects are present; no exception applies. Release propagation is simulated offline rather than performing a live upload. |
| #94: Remove checkout default-branch hints from docs/security/workflows. | A pre-checkout Git config step, disabling advice, or Git configuration in workflow env. | Copy the existing workflow-wide `GIT_CONFIG_*` policy so it applies before the first checkout. Test actual isolated `git init` behavior. |
| #94: Guard every workflow with checkout, including future ones. | Per-file assertions or scan every `.yml`/`.yaml`. | Repository-wide regression discovers both extensions and requires top-level configuration for each checkout workflow. |
| #95: Replace all 22 step-output interpolations in release shell code. | Individual step env mappings, shared layout export, or analyzer auto-fixes. | Every layout step writes the known root to `GITHUB_ENV`; release metadata goes through step `env`. Quote shell variables. Scan all workflow run blocks to prohibit direct expressions, including repository expressions beyond the reported 22. Action inputs remain expressions. |
| #95: Lower regular zizmor confidence to low. | Lower the floor or suppress individual findings. | Fix the findings and use `low`; run the same low-confidence audit locally. Keep the existing high-severity/high-confidence pedantic image audit. |
| #95: Use zizmor-action v0.6.4, which supports 1.30.1. | Upgrade the action or choose an older supported analyzer. | Upgrade the trusted tag to v0.6.4; verify 1.30.1 against its published digest table. |
| #95: One matching analyzer pin for action, CLI and reproduction comment. | Repeat a version with equality tests or use one env value. | `ZIZMOR_VERSION` is the sole workflow pin; action, pedantic CLI and reproduction command reference it. Regression checks all three. |
| #95: Pin secretlint and preset to the same exact version. | Versioned npx packages or a separate npm lockfile. | Pin both packages at 13.0.7, confirmed in npm registry metadata. Scan npx package arguments across all workflows. |
| #96: Make PyPI publication resumable with skip-existing. | Avoid uploads when present or let the publisher skip duplicate files. | Both publish actions use `skip-existing: true`, allowing incomplete multi-file uploads to resume. The standalone Twine publisher also uses `--skip-existing`. |
| #96: Explicitly wait for PyPI before smoke testing. | More pip retries, a reusable wait action, or JSON endpoint polling. | Shared stdlib helper polls the exact version endpoint with a 600-second monotonic deadline, 15-second intervals and requests capped at 10 seconds/remaining budget. Keep pip smoke retries for index/install verification. |
| #96: Explain timeout after successful upload. | Generic failure or explicit partial-success recovery guidance. | Error states the upload step succeeded, names package/version and final error, and explains safe reruns. Optional `--verbose` retry tracing defaults off. Tests cover deadline, transient status/network errors and permanent errors. |
| #96: Gate on artifacts: PyPI missing OR GitHub release missing. | Check tag, check PyPI only, or independently query both artifacts. | Read exact `[project]` fields; query version JSON and GitHub release-by-tag API. Only 404 proves absence; API/transport failures fail closed. Both release paths use the helper after any manual version bump. Matrix tests cover every state and both layouts. |
| #96: Recover after partial success without duplicate GitHub release failure. | Skip creation when a release exists or make creation idempotent. | Shared API probe preserves published releases and edits an existing draft to publish it. Unit tests cover both cases. Bare tags do not stop release creation. |
| #96: Exclude experiments from CodeQL. | Trigger path filters or analysis configuration. | Add and wire `.github/codeql/codeql-config.yml`, excluding `experiments` and `python/experiments`. Preserve Python/actions languages and security scanning of shipped code. |
| #96: Ship the documented `.lycheeignore`. | Remove instructions or provide an empty commented template. | Add the empty documented template; regression ensures it has no active exclusions. |
| #96: Limit GitHub link-check bursts. | Accept 429, globally serialize requests, or per-host limits. | Add `lychee.toml` with GitHub concurrency 2 and request interval 1s. Explicitly load it and trigger CI for config/ignore changes. Preserve existing transient recovery/final failure behavior; do not accept 429/5xx as valid. |
| User: Apply each defect throughout the codebase. | Fix cited lines only or scan all equivalent paths. | Scan all five workflows, both root/python layouts, automatic/manual releases, local publishing and existing tests/documentation. |
| User: Reproduce before implementation and prepare the next release. | Static checks only or behavior/policy regressions plus release fragment. | Initial policy suite failed 11 cases; zizmor reproduced 22 findings. Add deterministic release tests and a reusable experiment. A changelog fragment triggers the existing bump/collection workflow; retain the template's 0.1.0 version. |

## Root-cause evidence

Downloaded original runs to ignored local `ci-logs/` files. The default-branch
hint occurs in `workflows-37294585398.log` at lines 66, 374 and 540;
`docs-37294585301.log` at 70 and 477; and
`security-37314932499.log` at 65, 1623, 2131 and 3803. These are the runs cited
by #94, predating this branch, so they are baseline evidence rather than final CI.

zizmor 1.30.1 at low confidence reproduced 22 informational template-injection
findings before implementation (exit 11), despite the regular medium-confidence
job hiding them. Initial workflow policy regressions failed before changes.
The new helper's first test run reported missing-module setup errors separately;
these are new-feature scaffolding, not behavioral evidence of the old code.
The additional GitHub recovery tests failed twice against the old creator.

The old automatic gate treated a tag as a complete release receipt. With no tag,
it republished an already uploaded PyPI version; with a tag, it skipped missing
PyPI/GitHub artifacts. Both branches are wrong after partial success. The old
smoke test's six install attempts permit five 20-second delays, about 100 seconds
plus installation time. The dedicated wait separates propagation from package
verification and duplicate-file handling makes later retries safe.

## Online research and existing components

- [Git configuration](https://git-scm.com/docs/git-config) documents runtime
  `GIT_CONFIG_COUNT`/key/value configuration and `init.defaultBranch`; reuse it
  rather than installing a checkout wrapper.
- [zizmor template-injection audit](https://docs.zizmor.sh/audits/#template-injection)
  explains pre-execution template expansion and environment-variable remediation.
  [zizmor filtering](https://docs.zizmor.sh/usage/#filtering-results) documents the
  confidence floor. The [v0.6.4 action table](https://github.com/zizmorcore/zizmor-action/blob/v0.6.4/support/versions)
  contains 1.30.1; the action's table, not PyPI's latest package, determines what
  it can install.
- [secretlint 13.0.7](https://registry.npmjs.org/secretlint/13.0.7)
  and its matching preset exist in the npm registry and require Node >=22.
  Ubuntu 24.04's hosted environment satisfies this; a new Node dependency
  manager is unnecessary for this scanner-only use.
- [PyPI release JSON API](https://docs.pypi.org/api/json/#get-a-release)
  gives an exact name/version lookup. It does not state a CDN propagation bound;
  ten minutes is an operational retry budget, not a promise of visibility.
- [PyPA publisher](https://github.com/pypa/gh-action-pypi-publish#tolerating-release-package-file-duplicates)
  and [Twine upload](https://twine.readthedocs.io/en/stable/#twine-upload)
  already support skipping existing files. Reuse them for partial multi-file
  uploads. Version pinning does not claim transitive npm integrity locking.
- [GitHub release-by-tag API](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)
  distinguishes a release from a Git tag. The helper keeps authentication on
  the GitHub API host and disables redirects; PyPI receives no GitHub token.
- [CodeQL configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options)
  supports an analysis `config-file` and `paths-ignore`; trigger filters would
  not exclude experiment files from a running scan.
- [Lychee configuration](https://lychee.cli.rs/guides/config/)
  supports `hosts`, `concurrency` and `request_interval`. Existing Lychee and
  the repository's transient rechecker handle the problem without a new library.
- Recent prior art: [Interfaces #151](https://github.com/linksplatform/Interfaces/pull/151)
  guards checkout Git config; [browser-commander #129](https://github.com/link-foundation/browser-commander/pull/129)
  fixes env expansion, confidence and scanner pins; [links-notation #331](https://github.com/link-foundation/links-notation/pull/331)
  separates propagation waiting and applies host throttling. Their repository
  code was inspected through authenticated GitHub API downloads.

No new runtime dependencies are needed: urllib, tomllib, time and existing
layout/manifest helpers cover the release probe. Third-party retry libraries
would add dependency maintenance without improving this small bounded loop.

## Local verification results

- Full suite: **360 passed, 1 skipped** in 61 seconds; the skip requires the
  multi-language repository layout. Shipped `src` coverage is 100%.
- Ruff lint and format, mypy on `src`, file-size limits and Sphinx with warnings
  treated as errors all passed.
- Pinned actionlint (including shellcheck), zizmor 1.30.1 regular/low-confidence
  and pedantic/high-severity/high-confidence scans all passed. The regular scan
  has no findings after fixing the 22 reproduced injections.
- Secretlint CLI/preset 13.0.7 passed. The reusable experiment passed, as did
  the local HTTP integration test covering missing/transient/visible metadata
  and rejected redirects.
- The fetched default branch is already an ancestor of the prepared branch.

## Hosted verification plan

Review the full PR diff, commit/push only the prepared branch, update all four closing references,
verify hosted run timestamps/SHAs, download any failed logs, and mark PR #99 ready
after all checks pass. PR jobs intentionally cannot exercise a live publication;
network/recovery cases use deterministic offline tests instead.
