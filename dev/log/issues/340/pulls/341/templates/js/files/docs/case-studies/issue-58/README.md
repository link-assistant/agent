# Issue 58 Case Study: Real Example Package Release

## Scope

Issue: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/58

Pull request: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/59

Issue 58 asked the JavaScript template to use the real test package name
`@link-foundation/example-package-name`, publish it through the existing npm
trusted-publishing workflow, keep GitHub Release creation working, deploy the
universal example app to GitHub Pages, provide a globally installable CLI, and
preserve the full investigation under this case-study directory.

## Requirements

| Requirement                                                     | Resolution                                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Use `@link-foundation/example-package-name` as the package name | Updated `package.json` and `package-lock.json`, and added regression coverage for the name.                                                     |
| Keep npm publishing real and public                             | Added `publishConfig.access=public`, kept the existing OIDC trusted-publishing release jobs, and added a changeset for the next release.        |
| Keep GitHub Release creation                                    | No release workflow code change was needed; GitHub Release creation still runs only after a successful npm publish.                             |
| Add a globally installable CLI                                  | Added `bin/example-package-name.js` and the package `bin` mapping for the `example-package-name` command.                                       |
| Ensure example app builds are produced                          | Verified logs showed web and desktop artifacts were already produced; fixed the Pages deployment configuration path that failed after upload.   |
| Find why builds did not all release                             | Downloaded failed main workflow logs and identified one npm package-name failure and one repository Pages configuration failure.                |
| Compare CI/CD templates                                         | Captured JavaScript, Rust, Python, and C# template file trees and release workflows under `data/`.                                              |
| Store logs and data in this repository                          | Stored issue, PR, CI, registry, action-version, template-comparison, and verification data under `docs/case-studies/issue-58/data/`.            |
| Add reproducing tests before fixing                             | Added package metadata and workflow assertions, then captured their failing output in `data/regression-before.log` before implementing the fix. |

## Timeline

| Date/time (UTC)     | Event                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-12 12:02:38 | PR 57 merged to `main` at `9bb4f3306c7eabc4473051b028a1bb86b7a967e9`, triggering `Checks and release` and `Example app`.               |
| 2026-05-12 12:03:19 | The example workflow uploaded the web artifact `universal-example-web`; see `data/example-app-25733140224.log`, lines 828-838.         |
| 2026-05-12 12:03:20 | The example workflow uploaded the `github-pages` artifact; see `data/example-app-25733140224.log`, lines 881-891.                      |
| 2026-05-12 12:03:47 | GitHub Pages deployment failed with status 404 because Pages was not enabled; see `data/example-app-25733140224.log`, lines 1260-1267. |
| 2026-05-12 12:05:20 | Issue 58 was opened asking for a real test package name, CLI mode, release validation, Pages deployment, and a deep case study.        |
| 2026-05-12 12:05:24 | The release job detected package `my-package` as the publish target; see `data/checks-and-release-25733140225.log`, lines 6730-6749.   |
| 2026-05-12 12:05:53 | npm publish failed after retries with `PUT https://registry.npmjs.org/my-package - Not found`; see lines 6924-6949 of the same log.    |
| 2026-05-12 15:18:34 | The initial PR branch run passed against the placeholder commit at `486f7d75491fd0d46b9db3966434b8ec11d8c417`.                         |
| 2026-05-12          | This PR enabled repository Pages for workflow deployments through the GitHub Pages REST API and saved the resulting status data.       |

## Root Causes

### npm publish failed on the placeholder package

The `Checks and release` workflow still used the template package identity
`my-package` when PR 57 merged. The release scripts derived package metadata
from `package.json`, but the repository had not yet been adopted to a real npm
package name. The main release run bumped the package to `0.10.0`, then tried to
publish `my-package@0.10.0`. npm returned a 404 for the `PUT` request, so
Changesets retried and the release job failed.

The selected fix is to make this repository a real scoped test package:

- `package.json` name is now `@link-foundation/example-package-name`.
- `package-lock.json` root metadata matches that package name.
- `publishConfig.access` is `public`, which is required for a public scoped
  package publish.
- The existing release workflow keeps `id-token: write` and
  `registry-url: https://registry.npmjs.org`, so it remains aligned with npm
  trusted publishing.
- A changeset is included so the next main release has an explicit release
  trigger.

The npm registry probe in `data/npm-example-package-name-view.json` returned
404 before this PR, meaning the package is not visible as an already-published
package to this environment. The first successful main release still depends on
the npm-side trusted publisher being configured for the new package and this
repository's `release.yml` workflow. The local environment is not logged in to
npm, as captured in `data/npm-whoami.log`, so that npm-side setup could not be
completed from this checkout.

### GitHub Pages deployment failed after artifact upload

The `Example app` workflow built the Vite app and uploaded both the regular web
artifact and the GitHub Pages artifact. The failure happened only at
`actions/deploy-pages@v5`, which returned 404 and said GitHub Pages had to be
enabled.

The selected fix has two parts:

- Repository Pages was enabled for workflow deployments and the resulting state
  was saved in `data/pages-status-after-enable.json`.
- `.github/workflows/example-app.yml` now includes `actions/configure-pages@v6`
  before uploading and deploying the Pages artifact on `main` pushes.

The workflow still deploys Pages only on `push` to `main`; pull requests verify
the build and artifact packaging path without publishing a PR preview.

### Example app builds were produced, but release delivery was blocked

The downloaded `Example app` log shows desktop packages were created and
uploaded for Ubuntu, macOS, and Windows. The web build and GitHub Pages artifact
were also uploaded. That means the build jobs themselves were healthy; delivery
was blocked by repository Pages configuration, not by Vite or Electron.

Mobile native jobs remain intentionally gated behind repository variables and
manual dispatch because Android and iOS signing, project customization, and
store credentials are app-specific. Local Capacitor sync remains covered by the
example app scripts and case-study verification.

### The CLI entrypoint must work through npm bin links

Local temporary-prefix global install testing found an installability edge case:
the npm `bin` command is invoked through a generated link, so an entrypoint
guard that compares only raw paths can miss the real CLI invocation. The CLI now
resolves both paths before deciding whether to run, and
`data/npm-global-install.log` shows the installed command returning `42` for
`example-package-name multiply 6 7`.

## CI/CD Template Comparison

| Template   | Findings                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript | Uses Changesets, npm trusted publishing through GitHub Actions OIDC, and a release job that creates a GitHub Release only after npm publish succeeds. The missing adoption step was the package name itself, plus Pages repository configuration. |
| Rust       | The captured release workflow is Cargo-oriented and does not share the npm package-name failure mode. No sibling issue was opened.                                                                                                                |
| Python     | The captured workflow focuses on Python package build/test flows and does not share the JavaScript npm package-name failure mode. No sibling issue was opened.                                                                                    |
| C#         | The captured workflow is .NET-oriented and does not share the JavaScript npm package-name failure mode. No sibling issue was opened.                                                                                                              |

The shared best practices that apply here are explicit package identity,
release preflight checks, OIDC publishing permissions, current GitHub Actions
major versions, and storing workflow evidence when failures happen.

## Data Captured

Raw evidence is stored under `docs/case-studies/issue-58/data/`.

| File                                                                                                 | Purpose                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `issue-58.json`, `issue-58-comments.json`                                                            | Issue metadata, body, and comments.                                                                            |
| `pr-59.json`, `pr-59-conversation-comments.json`, `pr-59-review-comments.json`, `pr-59-reviews.json` | PR metadata and all PR comment channels.                                                                       |
| `main-ci-runs.json`                                                                                  | Recent `main` workflow runs used to identify current failures.                                                 |
| `checks-and-release-25733140225.json`, `checks-and-release-25733140225.log`                          | Failed main release run showing the `my-package` npm publish failure.                                          |
| `example-app-25733140224.json`, `example-app-25733140224.log`                                        | Failed example app run showing successful artifacts and failed Pages deployment.                               |
| `ci-run-25743983223.json`, `checks-and-release-25743983223.log`                                      | Initial PR branch run for the prepared branch.                                                                 |
| `npm-example-package-name-view.json`                                                                 | npm registry probe for `@link-foundation/example-package-name`.                                                |
| `npm-whoami.log`                                                                                     | Local npm auth probe showing this environment cannot configure npm-side trusted publishing directly.           |
| `npm-global-install.log`                                                                             | Temporary-prefix global install check for the generated `example-package-name` command.                        |
| `npm-pack-dry-run-final.json`                                                                        | `npm pack --dry-run --json --ignore-scripts` output showing the package name, tarball name, and shipped files. |
| `pages-enable-result.json`, `pages-status-after-enable.json`                                         | GitHub Pages REST API enablement result and final repository Pages status.                                     |
| `actions-*-release.json`                                                                             | Current release metadata for GitHub Actions used by the workflows.                                             |
| `{js,rust,python,csharp}-template-file-tree.txt`                                                     | File-tree captures for CI/CD comparison.                                                                       |
| `{rust,python,csharp}-template-release.yml`                                                          | Release workflow captures for sibling-template comparison.                                                     |
| `pr-57.json`, `pr-57.diff`                                                                           | The previous universal-app PR that introduced the failing main workflows.                                      |
| `regression-before.log`, `regression-after.log`, `regression-after-2.log`, `regression-after-3.log`  | Focused regression test output before and after the implementation.                                            |

## Online References

GitHub Pages supports deployment from GitHub Actions and documents the
Pages-specific deployment workflow:
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

GitHub's Pages REST API exposes repository Pages enablement and configuration,
which was used to verify and enable workflow-backed Pages:
https://docs.github.com/en/rest/pages/pages

npm trusted publishing documents GitHub Actions OIDC publishing and the required
trusted publisher relationship:
https://docs.npmjs.com/trusted-publishers

npm package metadata documents `name`, `bin`, `files`, and `publishConfig`,
which are the package fields changed by this PR:
https://docs.npmjs.com/cli/v11/configuring-npm/package-json

## Verification

Focused regression verification is stored in `data/regression-after.log` and
`data/regression-after-2.log`, with the final CLI symlink regression in
`data/regression-after-3.log`.

The package tarball dry run in `data/npm-pack-dry-run-final.json` shows:

- package id `@link-foundation/example-package-name@0.10.0`;
- tarball `link-foundation-example-package-name-0.10.0.tgz`;
- CLI file `bin/example-package-name.js` with executable mode;
- runtime files limited to `CHANGELOG.md`, `LICENSE`, `README.md`, `bin/`, and
  `src/`.

Local full verification logs:

- `data/npm-test-2.log`: Node.js test suite.
- `data/bun-test.log`: Bun test suite.
- `data/deno-test.log`: Deno test suite.
- `data/npm-check-final.log`: ESLint, Prettier, and jscpd.
- `data/secretlint.log`: secret scan matching the release workflow command.
- `data/npm-global-install.log`: temporary global install and CLI invocation.
- `data/check-mjs-syntax.log`: `.mjs` syntax check.
- `data/check-file-line-limits.log`: repository file line-limit check.
- `data/validate-changeset.log`: changeset validation.
- `data/example-web-build.log`: Vite production build.
- `data/example-desktop-package.log`: Electron Forge package command.
- `data/example-mobile-sync.log`: Capacitor sync command.
