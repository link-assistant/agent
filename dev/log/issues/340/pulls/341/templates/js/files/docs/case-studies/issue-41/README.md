# Case Study: File line-limit warn band for concurrent PR headroom

**Issue:** [link-foundation/js-ai-driven-development-pipeline-template#41](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/41)
**Related downstream incidents:** [link-assistant/hive-mind#1593](https://github.com/link-assistant/hive-mind/issues/1593), [link-assistant/hive-mind#1730](https://github.com/link-assistant/hive-mind/issues/1730)
**Sibling template report:** [link-foundation/rust-ai-driven-development-pipeline-template#40](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/40)

## Summary

The JavaScript template had a hard 1500-line CI gate in
`scripts/check-file-line-limits.sh`, but it had no warning band for files that
were close to the limit. A file at 1490-1499 lines could pass every PR check,
then fail only after multiple PRs merged close together and their combined
changes crossed the hard limit on `main`.

The fix ports the warn-band pattern from `link-assistant/hive-mind`: files above
1350 lines still pass, but they emit GitHub Actions warning annotations and a
summary in the job log. The hard failure above 1500 lines is unchanged.

## Requirements

Issue #41 and its follow-up comment asked for:

1. Add a `WARN_THRESHOLD=1350` warning band to `scripts/check-file-line-limits.sh`.
2. Keep the existing 1500-line hard failure.
3. Preserve issue data and logs under `docs/case-studies/issue-41`.
4. Reconstruct timeline, root cause, requirements, and solution options.
5. Compare CI/CD scripts and workflow files with `hive-mind` and the Rust template.
6. Search online for relevant supporting facts.
7. Report the same issue in the Rust template if present.
8. Add a reproducing test before the implementation.

## Timeline

| Date/time (UTC)     | Event                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-11 04:01:58 | `hive-mind` run 24274201449 failed `check-file-line-limits` because `./src/solve.auto-merge.lib.mjs` exceeded 1500 lines. See `data/ci-logs/hive-mind-run-24274201449.log`, lines 6588-6595. |
| 2026-04-29 17:45:26 | `hive-mind` run 25124605561 failed with three files over 1500 lines and also showed the 1350-line warning summary. See `data/ci-logs/hive-mind-run-25124605561.log`, lines 11924-11948.      |
| 2026-04-29 18:03:37 | JS template issue #41 was opened to port the warning band into this template.                                                                                                                |
| 2026-05-01 11:12:05 | Issue follow-up requested a full case study, template comparison, and sibling Rust template report if applicable.                                                                            |
| 2026-05-01          | Rust template issue #40 was opened because `scripts/check-file-size.rs` has a hard file-size limit with no warn band.                                                                        |

## Root Cause

The template already had a good hard gate:

```bash
LIMIT=1500
if [ "$line_count" -gt "$LIMIT" ]; then
  exit 1
fi
```

That catches oversized files, but it gives no signal when a file is close enough
that normal concurrent PR drift can push it over the limit. Fresh-merge
simulation helps when a PR reruns after another PR has already merged. It cannot
catch two in-flight PRs that both start from the same base and both individually
stay below the limit.

The downstream `hive-mind` case study for issue #1593 shows that exact shape:
one file was already close to the limit, two PRs passed independently, and the
combined result failed only after both reached `main`.

## Online Facts Checked

- GitHub Actions supports workflow command annotations such as `::warning` and
  `::error`, which makes the warn band visible in PR and workflow summaries:
  <https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions>
- ESLint `max-lines` supports counting all lines by default, with optional
  `skipBlankLines` and `skipComments` options. The template uses the shorthand
  `['error', 1500]`, so it does not have the ESLint-vs-`wc -l` desync that
  `hive-mind` fixed separately:
  <https://eslint.org/docs/latest/rules/max-lines>

## CI/CD Template Comparison

| Repository                                                     | Relevant check                      |                        Hard limit | Warn band before this PR | Finding                                             |
| -------------------------------------------------------------- | ----------------------------------- | --------------------------------: | ------------------------ | --------------------------------------------------- |
| `link-foundation/js-ai-driven-development-pipeline-template`   | `scripts/check-file-line-limits.sh` | 1500 for `.mjs` and `release.yml` | No                       | Needs `WARN_THRESHOLD=1350`.                        |
| `link-assistant/hive-mind`                                     | `scripts/check-file-line-limits.sh` | 1500 for `.mjs` and `release.yml` | Yes                      | Best-practice source for this fix.                  |
| `link-foundation/rust-ai-driven-development-pipeline-template` | `scripts/check-file-size.rs`        |              1000 for `.rs` files | No                       | Same early-warning gap; reported as Rust issue #40. |

The full file-tree captures are saved in:

- `data/js-template-file-tree.txt`
- `data/hive-mind-file-tree.txt`
- `data/rust-template-file-tree.txt`

Relevant workflow and script inventory:

| Repository    | Workflow files                                                              | File-size scripts                   |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| JS template   | `.github/workflows/links.yml`, `.github/workflows/release.yml`              | `scripts/check-file-line-limits.sh` |
| `hive-mind`   | `.github/workflows/cleanup-test-repos.yml`, `.github/workflows/release.yml` | `scripts/check-file-line-limits.sh` |
| Rust template | `.github/workflows/release.yml`                                             | `scripts/check-file-size.rs`        |

## Solution Applied

`scripts/check-file-line-limits.sh` now:

1. Defines `WARN_THRESHOLD=1350`.
2. Tracks warn-band files separately from failures.
3. Emits per-file `WARNING:` log lines and GitHub Actions `::warning` annotations.
4. Includes warn-band files in a non-blocking summary.
5. Keeps the existing `::error` annotations and non-zero exit for files over 1500.
6. Applies the warning behavior to both `.mjs` files and `.github/workflows/release.yml`.

## Test Coverage

`tests/check-file-line-limits.test.js` was added before the implementation and
failed against the old script because:

- `WARN_THRESHOLD=1350` was missing.
- A 1351-line `.mjs` fixture passed silently instead of warning.

After the implementation, the test verifies:

- The script defines the warn threshold and warning annotation path.
- 1351-line `.mjs` and `release.yml` fixtures warn but exit 0.
- A 1501-line `.mjs` fixture still exits 1.

The behavior fixtures run on Unix-like Node/Bun test environments. Deno and
Windows still get the read-only static test because the repository's Deno test
command grants only `--allow-read`, and shell fixture execution is intentionally
not required there.

## Why No New Debug Mode Was Added

The existing script already prints every checked file and line count. The saved
CI logs show the exact failure files and counts. This was an early-warning gap,
not an observability gap, so adding a persistent debug mode would not improve the
next investigation.

## Data Files

| File                                                 | Purpose                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `data/js-template-issue-41.json`                     | Issue #41 body and metadata.                                  |
| `data/js-template-issue-41-comments.json`            | Issue #41 follow-up comments.                                 |
| `data/js-template-check-file-line-limits-before.sh`  | Template script before this fix.                              |
| `data/js-template-release.yml`                       | Template release workflow snapshot.                           |
| `data/js-template-eslint.config.js`                  | ESLint file line-limit configuration snapshot.                |
| `data/js-template-file-tree.txt`                     | JS template file tree snapshot.                               |
| `data/js-template-warn-threshold-search-before.json` | Pre-fix code search for warn-threshold usage in this repo.    |
| `data/hive-mind-issue-1593.json`                     | Downstream original concurrent-merge incident.                |
| `data/hive-mind-issue-1593-comments.json`            | Downstream issue #1593 comments.                              |
| `data/hive-mind-issue-1730.json`                     | Downstream repeat line-limit incident.                        |
| `data/hive-mind-issue-1730-comments.json`            | Downstream issue #1730 comments.                              |
| `data/hive-mind-issue-1593-case-study.md`            | Downstream case study for issue #1593.                        |
| `data/hive-mind-issue-1730-case-study.md`            | Downstream case study for issue #1730.                        |
| `data/hive-mind-check-file-line-limits.sh`           | Best-practice script with warn band.                          |
| `data/hive-mind-file-tree.txt`                       | `hive-mind` file tree snapshot.                               |
| `data/ci-logs/hive-mind-run-24274201449.log`         | Failed CI log for issue #1593.                                |
| `data/ci-logs/hive-mind-run-25124605561.log`         | Failed CI log for issue #1730.                                |
| `data/rust-template-check-file-size.rs`              | Sibling Rust template file-size check snapshot.               |
| `data/rust-template-release.yml`                     | Rust template release workflow snapshot.                      |
| `data/rust-template-file-tree.txt`                   | Rust template file tree snapshot.                             |
| `data/rust-template-issues.json`                     | Existing Rust template issue search before sibling report.    |
| `data/rust-template-max-lines-search.json`           | Rust template code search for line-limit warning support.     |
| `data/rust-template-created-issue-url.txt`           | URL of the sibling Rust issue opened from this investigation. |
| `data/rust-template-issue-40.json`                   | Created sibling Rust issue metadata.                          |

## Follow-Up Options

Warn-only behavior is sufficient for this issue. A future stricter option would
be to fail PRs that modify files already in the warn band, but that policy needs
more owner input because it can block small urgent fixes in large files.
