# Issue 126: requirements, research, implementation and verification

Objective: implement every requirement of #120–#125 and parent #126 in PR #127,
across all affected workflows and helpers, without deferring requested work.

## Work checklist

- [x] Read parent issue, six sub-issues, all comments and PR conversation,
  inline review comments and reviews; confirm native sub-issue inventory.
- [x] Verify prepared branch and clean initial working tree.
- [x] Research official upstream sources and recent related PRs; compare reusable
  components and implementation options below.
- [x] Add minimal regressions and observe failures before each implementation.
- [x] Implement all criteria, including every artifact call site.
- [x] Run focused tests, then the complete Python suite and local CI checks:
  Ruff lint/format, mypy, file-size check, actionlint, zizmor and ShellCheck.
- [x] Add a release-triggering changelog fragment; commit useful atomic steps.
- [x] Fetch/merge latest main as needed; push only issue-126-89f22b11c0b0.
- [ ] Update PR title/body, retain separate Fixes references for #120–#126,
  document reproduction and verification; inspect full PR diff for regressions.
- [ ] List CI runs with timestamps/SHAs, preserve failed logs under ci-logs/,
  inspect errors with line numbers, fix causes, and verify latest-head CI passes.
- [x] Run hosted artifact round trip and 300+ changed-file CodeQL regression.
- [ ] Re-read final issue/PR feedback, check clean tree, mark PR #127 ready.

## Complete requirement inventory and candidate solutions

### #120: bounded artifact transport retries

- Cover diagnostic uploads, build/release artifacts and release-critical Pages
  uploads, and downloads where applicable; do not rerun successful tests.
- Retry transient DNS/socket failures (ENOTFOUND, ECONNRESET, ETIMEDOUT,
  ECONNREFUSED, EHOSTUNREACH), with finite attempts and backoff.
- Reconcile uploads whose successful final response was lost before retrying,
  avoiding duplicate-name conflicts and never accepting stale evidence.
- Preserve failure on exhaustion, missing/empty evidence, and permanent
  authentication/4xx/quota failures; never globally continue-on-error.
- Keep artifact runtime credentials inside a JavaScript action.
- Test recovery, exhaustion, permanent refusal, empty evidence and ambiguous
  successful uploads using injected errors.
- Options: maintained SDK inside a local JS action with injected dependencies;
  a generic retry action (less precise classification/reconciliation); shell
  retries (runtime credentials unavailable and poorer error handling).
- Plan: prefer SDK-backed local actions, shared transport helper, focused Node
  tests and actual hosted round trips. Preserve Pages tar artifact semantics.

### #121: full CodeQL analysis for large PRs

- Eliminate compare-API truncation warnings for >=300 changed files.
- Set CODEQL_ACTION_DIFF_INFORMED_QUERIES='false' for both init and analyze,
  retaining Python and Actions and every configured query.
- Do not suppress warnings or skip scanning; verify with a hosted >=300-file PR.
- Options: always full analysis (simple for this template), or conditional
  analysis after paginated file counting (more complexity and API permissions).
- Plan: job-level environment setting; workflow regression plus hosted evidence.

### #122: findings must fail aggregate Security gate

- Preserve normal Code Scanning upload and all queries/languages.
- Gate explicit local SARIF reports after analyze so the CodeQL job and
  aggregate workflow both reject unresolved findings of every severity.
- Reject missing/malformed reports and unsuccessful tool invocations.
- Inspect every report and every run; preserve reports even on failure.
- Test all severities, multiple files/runs and actual process exit statuses.
- Comment adds downstream real-world evidence and optional audited exceptions;
  no exception is required by this template, which has no intentional findings.
- Options: require external Code Scanning branch check (aggregate remains
  insufficient), or dependency-free local SARIF gate (observable in CI itself).
- Plan: local Python gate with fail-closed validation and regression fixtures.

### #123: missing or invalid failed-link report must fail

- For nonexistent LYCHEE_OUTPUT and nonzero checker status, return nonzero,
  explain the error and set all_archived=false; never emit true.
- Treat unreadable/empty/malformed reports after checker failure similarly.
- Retain independent live-link failure enforcement; archive suggestions cannot
  convert broken links into success. Preserve recovery of genuinely live links.
- Preserve report artifact with if-no-files-found=error.
- Test real subprocess statuses without network/Wayback access.
- Plan: validate report evidence before archive lookup; audit recheck helper
  and final workflow gate so invalid evidence cannot be accepted indirectly.

### #124: fenced changelog examples are not release headings

- Recognize exact target and next release headings only outside code fences.
- Handle backticks and tildes, matching character/closing length, info strings,
  indentation, CRLF and multiple change subsections.
- Preserve body content and indentation; do not drop examples/later prose.
- Fail explicitly when required release entry is missing (including target
  headings appearing only in examples).
- Options: Markdown AST parser (e.g. markdown-it-py, source offset slicing) or
  small fence-aware scanner (no runtime dependency for release scripts).
- Plan: fence-aware exact heading scanner and byte-preserving section slicing,
  with regression tests for extraction and publication call sites.

### #125: eliminate DEP0005 artifact download path

- Audit all downloads; avoid deprecated Buffer constructors in v8 extraction.
- Pin reviewed action revisions, keep digest verification enabled.
- Prefer fixed upstream release if available. Otherwise skip-decompress and
  use maintained Python zipfile after validating paths and symlinks.
- Verify bytes through hosted PR upload/download, with throw-deprecation.
- Test unsafe archives and normal/nested/empty/binary files if workaround used.
- Plan: inspect upstream #484/#490 and latest bundles first; integrate safe
  download path with #120 retry wrapper rather than duplicate mechanisms.

## Parent #126 and delivery requirements

- Single PR #127 on prepared branch; preserve history and do not merge main.
- Include separate positive closing references for all seven issues.
- Explicitly document any already resolved/non-reproducible criterion.
- All original behavior must remain unless an issue requests its removal.
- Keep large logs in ci-logs (untracked); scripts in experiments/examples.
- Bound memory/stack probes and run memory-heavy tools sequentially under the
  2.92 GiB container budget. Wait for all commands before ending work.

## Research and verification evidence

To be completed alongside implementation with source links and exact results.

### Sources and component choices (2026-10-29)

- [Artifact SDK](https://github.com/actions/toolkit/tree/main/packages/artifact):
  reuse @actions/artifact 6.3.1, Core 3.0.1 and Glob 0.7.0, exact pins plus lockfile;
  bundle with ncc 0.45.0. Its NetworkError path bypasses HTTP retry handling.
  npm audit reports zero vulnerabilities for the resulting dependency graph.
- [p-retry](https://github.com/sindresorhus/p-retry): supports bounded promise
  retries, but still needs custom transport classification and reconciliation;
  a small shared loop avoids an additional runtime dependency.
- [download-artifact #490](https://github.com/actions/download-artifact/pull/490)
  remains open; latest release is v8.0.2. The two-byte bounded offline probe in
  reproduce_artifact_buffer.mjs confirms DEP0005 in unzip-stream's constructor.
  Use SDK skipDecompress and explicit digestMismatch rejection until fixed.
- [Python zipfile](https://docs.python.org/3/library/zipfile.html): maintained
  standard-library extraction, with explicit path/type/collision validation.
- [Pages artifact format](https://github.com/actions/upload-pages-artifact/blob/main/action.yml):
  retain GNU tar artifact.tar, hidden-file policy and one-day retention.
- [CodeQL analyze inputs/outputs](https://github.com/github/codeql-action/blob/v4/analyze/action.yml)
  provide local output without disabling normal Code Scanning upload.
- [CodeQL full-analysis guidance](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-the-command-line/incremental-analysis):
  choose full analysis rather than incomplete diff filtering. Job-level env
  applies to init, autobuild and analyze; no query/language is removed.
- [CommonMark fence rules](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)
  define same-character, at-least-opening-length closing delimiters.
  [markdown-it-py](https://markdown-it-py.readthedocs.io/en/latest/using.html)
  offers source-mapped tokens, but a fence-aware scanner fits these release
  scripts without a new publication-time dependency and preserves CRLF bytes.
- [GitHub self-repository action syntax](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/find-and-customize-actions)
  binds the local action to the workflow commit. actionlint 1.7.12 lacks this
  syntax ([#711](https://github.com/rhysd/actionlint/issues/711)); its exact
  artifact-action diagnostic has a narrow documented exception. Other action
  errors remain enabled; both zizmor passes report no findings.
- Read recent merged PR #119 and downstream PR #32's reusable artifact helper.
  Adapted its SDK/reconciliation approach to all template artifact operations,
  with a bundled action so no install or credentials are needed in shell steps.
- [CodeQL URL validation guidance](https://codeql.github.com/codeql-query-help/python/py-incomplete-url-substring-sanitization/)
  recommends parsing the URL host, including for correctness outside security
  sinks. The full scan exposed four pre-existing substring checks in release
  badge code/tests. Shared exact-host detection fixes both release scripts;
  ten regressions cover misleading domains, paths, userinfo, query strings and
  prose, while retaining real badge/project-link idempotency.

### Reproduction and local verification

- Python bugs: 18 failures / 24 passes before fixes; all 42 cases passed after.
- CodeQL gate: pre-fix CLI/workflow regressions failed; 19 cases passed after,
  including two additional malformed-driver regressions found during review.
- Replayed real SARIF through the CLI: template analysis 2057844164 (clean)
  exits 0; meta-sovereign scheduled-security analysis 2049967568 from commit
  dc30f00aefb2c1a89c64bf7e7fa78ef80a860fe7 exits 1 and reports all 50 findings.
  Both reports were downloaded through the Code Scanning REST API with its
  application/sarif+json representation; this corroborates #122's comment.
- Artifact transfer: 19 Node cases pass, including DNS/socket recovery,
  exhaustion, permanent 4xx/quota refusal, stale-artifact refusal, lost-finalize
  reconciliation, empty evidence, Pages tar and verified raw downloads.
- ZIP extraction: 12 subprocess cases pass for nested/empty/binary content,
  traversal, absolute/Windows paths, symlinks, special files and corrupt ZIPs.
- Ruff, mypy, actionlint, both zizmor modes, ShellCheck and Sphinx -W pass.
- Badge regressions: six failures before the exact-host fix; all ten pass after.
- Full Python suite: 545 passed, one existing multi-language-layout skip.
- A temporary 301-file fixture brought PR #127 to 341 changed files. Its commit
  is reverted after hosted full-analysis evidence is recorded. GitHub's
  diff endpoint also rejects this fixture with HTTP 406 (300-file limit); source
  and workflow changes were reviewed locally before removing the fixture.

### Hosted verification before final cleanup

- [Security run 40959801018](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/actions/runs/40959801018)
  analyzed both Python and Actions on the 341-file diff at e7b8eef. Both Analyze
  steps completed and uploaded normal Code Scanning results with no diff-limit
  warning; no language or query was skipped. The Python gate then correctly
  rejected four existing badge substring findings and the aggregate Security
  gate failed. Actions had zero findings. Both SARIF artifacts survived failure.
  Preserved full workflow log: ci-logs/Security-40959801018.log; aggregate failure
  is at lines 5230–5231. The four findings and rejecting exit status are also at
  lines 1968–1973 of ci-logs/codeql-python-large-diff.log. These findings are fixed
  in both release helpers and their tests, without exclusions or suppressions.
- [Artifact Transport Regression job](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/actions/runs/40959801016/job/123749285519)
  passed all 19 injected regressions, reproduced the committed bundle from the
  lockfile, transferred nested/binary/empty evidence with strict deprecations,
  compared all bytes, and verified the Pages tar through a pattern download.
  The raw ZIP hashes matched and neither download emitted DEP0005.
- Docs and Broken Link Checker passed at the same commit. Final cleaned-head
  checks, including the badge correction, are recorded in PR #127 before it is
  marked ready; the large-diff Security failure above is deliberate gate
  evidence, not a claim that that historical run passed.
