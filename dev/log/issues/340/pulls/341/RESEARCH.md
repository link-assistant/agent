# Primary-source research and existing components

Research checked 2026-11-06/07 UTC. Evidence was collected from upstream
documentation and repository source/issues, rather than inferred from badges.

| Source | Fact and decision |
| --- | --- |
| [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) | `queue: max` permits up to 100 pending jobs and cannot accompany true cancellation. Separate read checks from writers. |
| [GitHub concurrency announcement](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/) | Queue expansion predates the current issue; a linter rejecting the property is a tooling compatibility gap. |
| [actionlint configuration](https://github.com/rhysd/actionlint/blob/main/docs/config.md) | Path-specific exact diagnostic exceptions belong in `.github/actionlint.yaml`; avoid Docker argument quote splitting. Snapshot in meta/. |
| [actionlint queue issue 657](https://github.com/rhysd/actionlint/issues/657), [PR 654](https://github.com/rhysd/actionlint/pull/654), [duplicate 746](https://github.com/rhysd/actionlint/issues/746) | Known queue support issue; do not file another duplicate. Keep semantic validation in repository tests. |
| [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/) | Uses the committed lockfile and fails on manifest mismatch. Replace resolution-mutating CI installs. |
| [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [npm registry API](https://api-docs.npmjs.com/) | Use GitHub OIDC and package-scoped token exchange; verify the write identity before expensive work. Never log returned tokens. |
| [npm overrides](https://docs.npmjs.com/cli/configuring-npm/package-json#overrides) | Overrides apply at the installation root. A dependency's override is not a consumer-wide policy. Clean consumer installation is tested separately. |
| [Bun overrides](https://bun.com/docs/pm/overrides) | Supports dependency overrides; frozen installs require a matching Bun lockfile. Use the same graph policies in both package managers. |
| [lino-arguments issue 50](https://github.com/link-foundation/lino-arguments/issues/50) | The 0.4.0 environment ambiguity was real; 0.4.1 fixes it. Remove the obsolete exception and test agent-relevant legacy process.env configuration. |
| [nolyfill PR 123](https://github.com/nolyfill/nolyfill/pull/123) | A dedicated node-domexception replacement is distinct from the existing domexception module. The experiment demonstrated the latter is incompatible; a one-line native adapter avoids that mismatch. |
| [crates.io publish handler](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/publish.rs) | Server source authenticates publish scope before reading archive length. Exact missing-archive response is a bounded credential probe, not a full ownership or successful-publication proof. Snapshot in meta/crates-publish.rs. |
| [dorny/paths-filter](https://github.com/dorny/paths-filter) | Existing reusable change-filter action supports merge-base comparisons. Chosen alternative: adapt the template's dependency-free Git comparison already needed by version/changeset guards, reducing action/runtime dependencies. |
| [Changesets](https://github.com/changesets/changesets) | Keep the established JS release-fragment system; no need to introduce release-please or another version owner. |
| [cargo-outdated](https://github.com/kbknapp/cargo-outdated) | Keep the existing tool; distinguish its configurable outdated exit code from operational failures. |
| [lychee](https://github.com/lycheeverse/lychee), [zizmor](https://github.com/zizmorcore/zizmor), [secretlint](https://github.com/secretlint/secretlint) | Existing components already solve link/workflow/secrets analysis. Preserve their checks and improve orchestration/artifact evidence instead of building replacements. |

Alternative broad dependency automation (Renovate/Dependabot) can propose future
upgrades but does not resolve event-policy errors or prove registry credentials.
No new bot or unrelated service is required to complete this issue.

The template snapshots are pinned to commits recorded in `templates/*/commit.json`.
All 941 blob contents and full trees are preserved, Git-object-hash verified and compared, with a path-by-path applicability
inventory and individual content diffs. Five upstream reports cover read-only-main cancellation, stale hook installation
state and unchecked release synchronization, with finite reproductions, workarounds
and suggested code/tests; their
permanent URLs are in `reports/upstream-urls.txt`.

Additional security review sources:

- [OWASP HTML output encoding](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html): encode untrusted text for its HTML output context; retain human-readable error text.
- [URL hostname](https://developer.mozilla.org/en-US/docs/Web/API/URL/hostname): compare the parsed normalized hostname exactly, with a separate protocol check.
- [Bun escapeHTML](https://bun.com/guides/util/escape-html): existing runtime alternative; explicit HTML character encoding keeps the trust boundary visible to static analysis without an additional dependency.
- [GitHub CodeQL path configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options): exclude archived third-party snapshot contents from extraction, while continuing to scan actual agent code and workflows.

Release command review:

- [command-stream shell settings](https://github.com/link-foundation/command-stream/blob/main/js/README.md#shell-settings-api): default nonzero exits resolve; enable shell.errexit(true) for CI/release scripts. Reuse this existing API rather than hand-checking each command.
- [GitHub release API](https://docs.github.com/en/rest/releases/releases#create-a-release): validation failure is not proof a release already exists. Confirm the exact tag through the successful release lookup; missing-resource and authentication failures have distinct outcomes.
- [Node createRequire](https://nodejs.org/api/module.html#modulecreaterequirefilename): resolve the reviewed packages from the installed JS dependency tree and preserve existing CommonJS normalization. This adopts the pinned JS template loader approach and removes the release-time CDN fetch/eval.

Incomplete-escaping follow-up:

- [CodeQL incomplete sanitization](https://codeql.github.com/codeql-query-help/javascript/js-incomplete-sanitization/): partial string replacement can leave backslashes and regex metacharacters active. Its recommended alternative is a design that needs no sanitization. Exact changelog heading comparison and direct Git argument arrays implement that alternative.
