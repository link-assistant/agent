# Issue 228: require complete CI evidence

The issue body and its two comments identify four independent false negatives.
No required sub-issues or PR review requests were present at the initial audit.
The root JavaScript detector reports `required: false`: JavaScript in this
repository is tooling or an independent example, not a native counterpart.

| Requirement | Root cause and implementation | Verification |
| --- | --- | --- |
| Keep adjacent lychee failures, including empty descriptions | Whitespace after a URL consumed a newline. Parse within the errors section and keep all separators and descriptions on one line. | `scripts/recheck-broken-links.test.mjs` tests adjacent 404/ERROR/TIMEOUT entries, descriptions, section boundaries, LF and CRLF. The new test fails on the original parser. |
| Reject incomplete CodeQL extraction/configuration | `executionSuccessful` was trusted without checking invocation diagnostics. Validate both notification arrays in every invocation, fail on warnings/errors/default warning or malformed records, and retain descriptor/location/message in errors. | `scripts/check-codeql-results.test.mjs` exercises both arrays with empty results, later invocations, malformed arrays/records and allowed note/none. The extraction regression fails on the original gate. Existing vulnerability assertions remain. |
| Scan committed evidence regardless of build ignores | Glob scanning used `.gitignore` as a security exclusion. Inventory tracked paths with NUL-delimited Git output, pass literal paths to locked secretlint with ignores disabled, and inflate gzip evidence with finite input/output limits. | `.github/scripts/check-secrets.test.mjs` uses isolated Git repositories with synthetic credentials in force-added ignored logs, experiments, special filenames and gzip data; untracked output is skipped and corrupt/oversized gzip fails. Runs in the secrets CI job before the real scan. |
| Propagate Git failures and preserve successful empty diffs | Failed Git calls and empty diffs both became empty strings, selecting fallbacks. Return fallible Git results and inspect commit parent headers before selecting an initial-commit or PR fallback. | Inline Rust tests and the issue-228 CLI regressions cover missing/corrupt Git data, mocked command failures, initial/empty commits, PR merge behavior and output-write failures. The empty-commit regression fails on the original detector. |

Reproduce the reported parser and SARIF bugs with the literal inputs in issue
228, or run the regression suites above. For ignored credentials, the scanner
test creates the synthetic credential at runtime and force-adds each fixture;
no credential fixture is committed. Gzip checks are sequential and capped at
128 MiB compressed and decompressed per file. Dependencies are installed with
`npm ci --prefix .github/secretlint --ignore-scripts --no-audit --no-fund`.

The release pipeline consumes changelog fragments as its version trigger;
package versions are left to that writer as required by CONTRIBUTING.md.
