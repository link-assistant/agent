# Issue 287 verification evidence

The requirement inventory is in [plan.md](plan.md); implementation alternatives
and source research are in [research.md](research.md). PR 288 contains all five
issues and remains the only publication target for this work.

## First candidate CI investigation

All six workflows started on 2026-11-06 at 06:31:41 UTC for the exact candidate
`750824ac5ebff332a10e63c242f8fb5503dc51e8`. Every run completed before the next
push. Complete failing-run logs were downloaded into ignored `ci-logs/` files.

- [Checks and release](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/42174994794):
  all nine platform/runtime test jobs failed. The existing exact commit-message
  tests locate their source block using the `Push directly` comment; changing
  that delimiter caused a null match (log lines 4223 and 16199). Restore the
  delimiter without changing either acceptance assertion. The existing minimal
  workflow fixture has no zizmor config (lines 7860 and 16231); permit its absence
  only when there are no self-repository consumers. Missing configuration still
  rejects actual consumers. Windows also exposed filename splitting on `/`
  alone (lines 7895–7930); support both separators and CRLF configuration, with a
  platform-independent regression. All other jobs passed or skipped as intended;
  terminal failure correctly reflected the runtime failures.
- [Security](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/42174995046):
  the CodeQL result checks rejected valid success notifications (log lines 2965
  and 5407). Downloaded SARIF artifacts contain 217 JavaScript and 14 Actions
  diagnostics with `level: none` and empty `message.text`, identifying successful
  extraction. Accept string messages, including empty strings; still reject
  missing messages, malformed records, warning/error/default-warning levels and
  all findings. Regressions cover both notification arrays. Both actual SARIF
  artifacts pass the corrected checker. npm audits, dependency submission and
  dependency review passed.
- [Workflows](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/42174994936),
  [Example app](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/42174994809),
  [Broken Link Checker](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/42174994716)
  and the [mixed-language example](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/42174994831)
  passed. This includes actionlint, both zizmor passes, hosted artifact roundtrip,
  the real preview container tool/credential smoke, and desktop packaging on all
  three operating systems.

## Local verification

Initial focused native JavaScript coverage passed 148 Node cases and 96 cases
each under Bun and frozen Deno. Offline baseline/fixed probes, all three zero
vulnerability npm audits, actual SDK archive extraction, actual desktop ASAR
packaging, and pinned CLI/isolated credential checks passed. Native syntax,
line limits, changesets, status-gate coverage, workflow policy, ShellCheck,
lint, formatting and duplication checks passed.

The compatibility follow-up passes 52 cases each under Node, Bun and frozen Deno,
including the existing failing acceptance tests and the new Windows/CRLF and
empty CodeQL success diagnostics. The two downloaded real SARIF reports also
pass. Final same-revision hosted evidence is recorded in PR 288 after CI finishes.
