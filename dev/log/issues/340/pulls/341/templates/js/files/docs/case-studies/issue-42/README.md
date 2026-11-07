# Issue 42 Case Study: Derive npm Package Name

## Scope

Issue: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/42

Pull request: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/45

This case study preserves the issue data, PR data, CI logs, code-search evidence, and cross-template comparison requested in the issue comment. The implementation changes are in the same PR.

## Timeline

- 2026-04-30 02:30:41 UTC: Issue 42 was opened after applying this template to `link-assistant/agent-commander`. The reported failure mode was that `scripts/publish-to-npm.mjs` checked `my-package@<version>` instead of the package named in `package.json`.
- 2026-05-01 11:12:02 UTC: The issue comment expanded the request to include full CI/CD template comparison, raw evidence download, online research, root-cause analysis, and related-template issue reporting if the same issue exists.
- 2026-05-01 11:14:07 UTC: PR 45's initial placeholder commit triggered CI run `25212342558`, which completed successfully before the fix was implemented.
- 2026-05-01: Investigation found the same template-adoption hazard in multiple JavaScript release helpers, not only `publish-to-npm.mjs`.

## Requirements

- Derive the npm package name from the package manifest at runtime instead of using `const PACKAGE_NAME = 'my-package'`.
- Reproduce the bug with automated tests before fixing it.
- Compare the JavaScript CI/CD scripts and workflow with the Rust template.
- Download issue, PR, CI, and related investigation data into `docs/case-studies/issue-42`.
- Search online for relevant facts and established tooling behavior.
- Report related template issues if the same issue is found in another template.
- Keep the work in PR 45 on branch `issue-42-28b78f974190`.

## Evidence

Raw evidence is stored under `docs/case-studies/issue-42/data/` and `docs/case-studies/issue-42/ci-logs/`.

- `issue-42.json` and `issue-42-comments.json`: issue body and expanded requirements.
- `pr-45.json`, `pr-45-conversation-comments.json`, `pr-45-review-comments.json`, and `pr-45-reviews.json`: PR metadata and comment channels.
- `ci-runs-branch.json` and `ci-logs/checks-and-release-25212342558.log`: branch CI history and the initial successful placeholder-run log.
- `js-template-file-tree.txt`: JavaScript template file tree used for CI/CD script review.
- `rust-template-file-tree.txt`, `rust-template-head.txt`, and `rust-template-ci-cd-findings.txt`: Rust template comparison data.
- `link-foundation-my-package-search.txt` and `link-foundation-package-name-search.txt`: GitHub code-search evidence for placeholder usage across related repositories.
- `related-merged-prs-publish-to-npm.json` and `related-merged-prs-check-release-needed.json`: related historical PRs used to understand local conventions.

## Online References

Official npm documentation confirms that publishable packages are identified by the `name` and `version` fields in `package.json`, and that `name` plus `version` form the package identifier:
https://docs.npmjs.com/cli/v11/configuring-npm/package-json

The `npm view` command reads registry metadata for a package specifier, so checking the wrong package specifier can produce a false "already published" result:
https://docs.npmjs.com/cli/v11/commands/npm-view

The release workflow uses trusted publishing. npm's trusted publishing documentation describes GitHub Actions OIDC publishing and the `id-token: write` permission requirement:
https://docs.npmjs.com/trusted-publishers

## Root Cause

The root cause was duplicated package identity. `package.json` already defines the package name and version, but several release scripts copied the package name into hard-coded constants. During template adoption, `package.json` is naturally updated first; script constants are easy to miss.

The reported script, `scripts/publish-to-npm.mjs`, used the hard-coded name for:

- the `npm view <package>@<version> version` already-published check;
- post-publish registry verification;
- output and logging.

The same duplicated-identity pattern was also present in:

- `scripts/create-manual-changeset.mjs`;
- `scripts/merge-changesets.mjs`;
- `scripts/validate-changeset.mjs`;
- `scripts/format-release-notes.mjs`.

`scripts/check-release-needed.mjs` already derived package metadata from `package.json`, so the fix aligned the rest of the release helpers with that pattern.

## Rust Template Comparison

The Rust template does not show the same issue. Its release scripts derive package metadata through `scripts/rust-paths.rs` and `read_package_info`, then use the derived `PackageInfo` in release checks and publishing. It also has explicit template-default skip logic for `example-sum-package-name`.

Because the comparable Rust template already derives package identity from `Cargo.toml`, no Rust-template issue was opened.

GitHub code search found placeholder constants in downstream repositories that appear to have copied earlier versions of the JavaScript scripts. This PR fixes the source JavaScript template so future adopters do not inherit the same issue.

## Solution

The PR adds `scripts/package-info.mjs` as the single JavaScript package-identity helper. It provides:

- `parsePackageInfo` and `readPackageInfo` for package name/version parsing and validation;
- `formatNpmPackageVersion` for `name@version` npm specifiers;
- `formatChangesetHeader` and `getChangesetVersionTypeRegex` for package-specific changeset handling.

The release helpers now derive the package name from `package.json` at runtime. The README no longer instructs template adopters to update script-level package constants.

## Alternatives Considered

- Fix only `publish-to-npm.mjs`: rejected because the same root cause existed in other release helpers and would leave future adoption failures in changeset validation, manual changeset creation, and release-note formatting.
- Add an adoption validation script: useful as a possible future enhancement, but deriving from the manifest removes the duplicated state instead of detecting it after the fact.
- Open an issue in the Rust template: rejected because the Rust template already uses derived manifest metadata and template-safe publish skip logic.

## Verification

Local verification commands run for this PR:

```bash
bash scripts/check-mjs-syntax.sh
npm test
bun test
deno test --allow-read
npm run lint
npm run format:check
npm run check:duplication
node scripts/validate-changeset.mjs
```
