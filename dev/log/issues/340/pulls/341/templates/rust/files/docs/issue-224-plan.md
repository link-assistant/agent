# Issue 224 implementation and verification plan

All seven attached issues, their comments, and PR 225's conversation, inline
comments and reviews were read on 2026-10-29. There were no comments or reviews.
This is one batch on `issue-224-3324112cf91c`; only its coordinator pushes.

## Requirement inventory and proposed solutions

| Issue | Complete requirement | Implementation plan | Verification |
| --- | --- | --- | --- |
| 217 | Check sources named retarget/target_matcher, `.github` sources, and checkouts containing excluded words; exclude only whole relative components and prune real dependency/VCS/build trees. | Keep WalkDir; use root-relative components and `filter_entry`. | Oversized fixtures in all affected paths; actual excluded trees stay ignored. |
| 218 | Never interpret failed crates.io, Docker Hub or GitHub lookups as unpublished; retry transient errors with bounded exponential backoff; 404 alone means absent; permanent/exhausted/malformed results stop release decisions and version mutation. | Share a typed HTTP/registry helper across both release scripts; retain ureq 2, finite request deadlines and four attempts. | Local HTTP fixtures for recovery, exhausted transport/429/5xx, permanent errors, missing versions and malformed responses; CLI proves no release output or mutation on uncertainty. |
| 219 | Retry Wayback network errors, timeouts, 429/5xx and unreadable answers; return definite no-snapshot immediately; distinguish unavailable lookup from absent snapshot in annotations and `all_archived`. | Injectable native JavaScript lookup with three attempts; separate failed-lookup reporting. | Native mocked fetch tests and CLI report/output tests, without real archive access. |
| 220 | Missing, unreadable, empty or malformed lychee reports after failure must exit nonzero and never emit `all_archived=true`; preserve reports and live-link final gate. | Validate reports and parsed error totals; propagate checker exit to the archive step and retain independent workflow failure. | Subprocess regressions for every invalid report and valid clean/recovered reports. |
| 221 | Analyze/upload success is insufficient: inspect every SARIF file/run; reject absent/malformed reports, unsuccessful invocations and unresolved findings at every severity; preserve queries/upload and artifacts after failure. Any necessary exception must bind rule/file/line/full source SHA256/reason/test. | Add dependency-free native JavaScript SARIF gate and integrate both CodeQL matrix languages; initially no exceptions. | Synthetic multiple-file/run/severity/execution/CLI fixtures; same-revision CodeQL and aggregate checks. |
| 222 | Exact release headings outside backtick/tilde fences only; matching fence delimiter and length; preserve body bytes/indentation; fail missing required entries. | Small shared scanner, avoiding a Markdown dependency, used by the publication script and any equivalent scanner found. | Fenced boundary/target-only, mismatched/long/indented fences, CRLF, subsections, byte preservation, missing entries and publication CLI. |
| 223 | Remove DEP0005 artifact extraction everywhere; keep digest verification, pin reviewed download revision, validate ZIP paths/symlinks and verify bytes in PR upload/download regression. | Until upstream fixes extraction, download raw ZIPs using `skip-decompress`, extract via Python stdlib with traversal/symlink checks; reusable local action for all callers. | Bounded hostile ZIP fixtures, default/named/pattern/merged behavior, and PR round trip under `--throw-deprecation`. |
| 224 | Complete all work in PR 225, retain features/assertions, include one positive closing keyword per issue including 224; report any already-resolved criterion explicitly. | Update the existing PR with final behavior, reproductions and evidence; no merge/release/deployment. | Full diff review, clean committed tree, current main ancestry, all same-candidate CI outcomes collected before another batch. |

## Execution checklist

- [x] Read CONTRIBUTING.md, docs/javascript-first.md, every issue and PR comment.
- [x] Verify prepared branch, clean initial tree, current main and initial CI SHA.
- [x] Research official upstream contracts and existing maintained components.
- [x] Add failing regressions before fixes; validate native JavaScript changes first.
- [x] Implement all affected callers without removing acceptance assertions.
- [x] Record native-only adapters and translation scope: these are existing
  Rust-only maintenance scripts, not a production JavaScript port. New archive
  and SARIF behavior is native JavaScript; ZIP extraction is an explicit Python
  standard-library adapter. The existing opt-in JavaScript parity inventory and
  strict readiness gate must continue passing unchanged.
- [x] Run native tests, bounded script suites, format, Clippy, Cargo warning,
  workflow-tool, file-size, crate and doc tests. Use one Rust compiler process,
  compatible caches, logs under ignored `ci-logs/`, no cache deletion.

Finalization protocol: review the whole diff, commit useful atomic changes,
verify that exact candidate and push once. Collect every same-SHA CI failure
before preparing another batch. Update PR 225 with the actual outcome and every
closing reference, and mark it ready only after verification is complete.
The PR description records the final candidate and CI evidence.

## Research and component choices

- [download-artifact v8.0.2](https://github.com/actions/download-artifact/tree/9000827ccba6bdab643e8b6fd33ac0654aef8333)
  documents `skip-decompress` and `digest-mismatch: error`. Its bundled extractor
  still uses obsolete Buffer constructors; upstream
  [PR 490](https://github.com/actions/download-artifact/pull/490) remains open.
  The raw downloader uses artifact-name directories for multiple downloads and
  a direct file for named/single downloads. Preserve both layouts. Download raw
  artifacts separately before merging to avoid ZIP filename collisions.
- [Python zipfile](https://docs.python.org/3/library/zipfile.html) is maintained,
  installed on the affected Ubuntu runners, and supports streaming with CRC
  verification. Validate names and Unix member types before any extraction;
  reject destination symlinks and collisions. `archive: false` uploads are not
  used by these callers and this adapter explicitly refuses non-ZIP inputs.
- [CodeQL analyze contract](https://github.com/github/codeql-action/blob/main/analyze/action.yml)
  exposes `output` and keeps `upload: always` by default. A dependency-free Node
  gate can inspect every local result without relying on eventual API state,
  branch rules or additional permissions. No query is removed and no exception
  is initially necessary. A result marked SARIF `baselineState: absent` is
  resolved; suppression metadata alone does not authorize an exception.
- [Wayback availability API](https://archive.org/help/wayback_api.php) distinguishes
  an empty snapshot object from a returned closest snapshot. Native fetch,
  AbortSignal and timer promises cover retries without a new HTTP dependency.
- [ureq 2](https://docs.rs/ureq/2/ureq/) already supplies HTTP status/transport
  errors and finite AgentBuilder timeouts. Keep it instead of adding reqwest or
  a retry framework; share the small retry policy and JSON validation.
- [WalkDir filter_entry](https://docs.rs/walkdir/2/walkdir/struct.IntoIter.html#method.filter_entry)
  prunes excluded trees; std path components avoid substring and checkout-name
  errors without another glob library.
- [CommonMark fences](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)
  require matching characters and a closing run at least as long as the opener,
  with up to three leading spaces. A byte-offset scanner preserves the original
  body. A full parser such as
  [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) could provide
  an AST, but is unnecessary for this narrow release-heading contract.

## Coverage and compatibility review

- Reused the release scanner in both changelog writers, publication, write
  verification and the existing parsing experiment/tests. The historical
  issue-29 case study retains its original code excerpt. The issue-143 probe
  deliberately retains its old lookup as the negative comparison.
- All three production artifact download sites now use the same adapter.
  Uploads, attestations, six desktop targets and Docker digest merging remain.
  Actionlint 1.7.12 rejects the newer `$/` same-repository syntax; the local
  action calls retain the repository's existing narrowly annotated `./` form.
- The old test requiring warning suppression now requires real extraction
  without suppression. The old missing-version fallback assertion now requires
  an error, as #222 requests; valid empty-section fallback remains. The inline
  script inventory assertion increases from 17 to 19 for the two new helpers.
  Other acceptance assertions remain.
- No CodeQL exceptions or query exclusions were needed. The SARIF gate rejects
  suppression metadata alone; genuinely resolved `baselineState: absent`
  results are accepted.
- A `bump: patch` fragment supplies the release trigger. Package versions stay
  under the release writer's ownership, as CONTRIBUTING.md requires.

## Reproduction and local verification

The new tests failed against the original implementations before fixes. Run:

```sh
node --test experiments/issue-224-native.mjs scripts/*.test.mjs
CARGO_BUILD_JOBS=1 bash scripts/test-scripts.sh
cargo fmt --all --check
CARGO_BUILD_JOBS=1 cargo test --all-features
CARGO_BUILD_JOBS=1 cargo test --doc
CARGO_BUILD_JOBS=1 cargo clippy --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=1 bash scripts/check-cargo-warnings.sh
rust-script scripts/check-file-size.rs
rustc scripts/check-workflow-tools.rs -o /tmp/check-workflow-tools
/tmp/check-workflow-tools --verbose
```

The script runner includes local HTTP registry fixtures, a stubbed publication
CLI, hostile ZIP fixtures and all native JavaScript suites. Registry/publication
fixtures use isolated repositories and cannot publish externally. Python and
Node subprocess probes have finite inputs/deadlines; Rust builds use one job.
Native parity, regeneration and translated-example tests also pass unchanged.
Workflow validation uses the same pinned Actionlint, Zizmor and ShellCheck as CI.

For the optional upstream dependency reproduction, install `unzip-stream@0.3.4`
outside the checkout and run
`UNZIP_STREAM_ROOT=/path/to/installation node experiments/issue-223-deprecated-extractor.cjs`.
The bounded child reproduces DEP0005 and asserts that precise failure.
[Node's Buffer deprecation contract](https://nodejs.org/api/deprecations.html#dep0005-buffer-constructor)
explains why this isolated node_modules probe enables `--pending-deprecation`:
the action instead bundles that code into its application file.

## Initial same-revision CI investigation

The initial runs at `dd63f6f611668d726f6e489fa2cd7d03e394b725` were created
2026-10-29 21:04:54 UTC. CI/CD and Security passed. In
[Desktop run 40954664492](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/actions/runs/40954664492),
five platform builds passed; macOS arm64 never acquired a `macos-14` runner.
The job had no executed steps or runner ID. Its annotation reported
"The job was not acquired by Runner of type hosted even after multiple attempts";
the aggregate status log lines 163 and 177 recorded `abandoned` and
`Failing jobs: build`.

This coincided with the published
[macOS 14 retirement brownout](https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/)
on October 29, 14:00–00:00 UTC. GitHub also warns of reduced capacity before
November 2 retirement. Move this target to supported `macos-15` and retain
arm64 packaging; a runner assertion reproduced the old configuration first.
Logs and API annotations are retained locally under ignored `ci-logs/`.
