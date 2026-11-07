# Issue 138: requirements, research and verification plan

Read scope: parent #138, native children #136/#137, all issue comments,
PR #139 conversation/inline comments/reviews (none initially), latest merged
PR #134, downstream sensitive-data-sanitizer #93 and link-cli #166.

## Requirement inventory and selected solutions

| Requirement | Implementation plan | Verification |
| --- | --- | --- |
| #136 exact internal `fatal error in commit_refs_rules` and explicit HTTP 429/5xx | Classify transient before races, after policy refusals | parameterized classifications, recovery tests |
| At most three unchanged pushes with backoff | Existing bounded loop, exponential sleeps only for transient failures | identical arguments, two sleeps, no pull/rebase |
| GH006/GH013 remain permanent, no bypass/force | Keep policy precedence and immediate exit | mixed-error tests |
| Preserve stderr; default-off classification/attempt diagnostics | Print each failed response; opt-in `RELEASE_DEBUG=1` | captured output tests |
| #136 comment: retain validated SHA | Workflow passes immutable event SHA; local fallback captures starting HEAD | workflow and real Git tests |
| Accept only validated checkout or attested metadata-only child | Require sole direct parent, compare entire Git tree including modes | source drift, parent loss, merge/extra child tests |
| Matching/different version is insufficient; compare parsed manifest/lock | Ignore only project.version and matching local uv package version; all dependencies/other files immutable | manifest and uv dependency drift tests |
| Adopt verified previous release child | Reset only a clean checkout after full attestation | actual Git remote recovery test |
| Attest before/after rebase and before push | Validate remote before pull; validate resulting HEAD and clean worktree before push | push race drift/rebase tests |
| #137 inspect every invocation and both notification arrays, even with empty results | Explicit notification shape and severity validation | CLI parameter matrix, later invocation/run tests |
| Fail error/warning/missing level, malformed arrays/records | SARIF default warning; validate messages, descriptor and locations | missing/unknown/wrong type cases |
| Allow valid note/none and print descriptor/location/message | JSON-escaped diagnostic context, no workflow commands | CLI diagnostics and informational cases |
| Preserve ordinary unresolved findings gate | Retain existing all-findings rejection | existing regressions |
| #138 single PR, all closing references, no deferral | Update #139 and changelog release trigger | final diff, clean tree, main ancestry, CI SHA |

## Alternatives and source research

- [SARIF 2.1.0 specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
  defines notifications separately from results and the default warning level.
- [Microsoft SARIF tutorial](https://github.com/microsoft/sarif-tutorials/blob/main/docs/3-Beyond-basics.md)
  explains execution vs configuration notifications. Schema validation alone cannot
  enforce this repository's policy that warnings invalidate extraction evidence.
- [Tenacity](https://tenacity.readthedocs.io/en/stable/) provides bounded retries and
  exponential waits; [urllib3 Retry](https://urllib3.readthedocs.io/en/stable/reference/urllib3.util.html)
  handles HTTP clients, not Git subprocesses. Retain the small existing stdlib loop
  instead of adding runtime dependencies for three attempts.
- [GitHub rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
  recommends bounded exponential waits. Git stderr does not expose reliable response
  headers, so use bounded waits for explicit 429/5xx, without guessing internal causes.
- [sarif-tools](https://pypi.org/project/sarif-tools/) offers report processing;
  it is unnecessary for the existing small JSON policy gate. Retain stdlib JSON.
- [uv lock documentation](https://docs.astral.sh/uv/concepts/projects/layout/)
  identifies uv.lock as TOML containing exact dependency resolution. Compare parsed
  data, narrowly normalize the local package version, keep all dependency metadata.
- Downstream #93 separates release recovery from transient retries; #166 checks
  notifications independently of successful invocations. Adapt these concepts to
  TOML and existing Python helpers rather than copying JavaScript.

## Work sequence

1. Add regressions and record failures on original implementation.
2. Draft both fixes, source/lock attestation, workflow wiring and documentation.
3. Run focused regressions and Ruff; commit atomic fixes and push only prepared branch.
4. Review full PR diff; verify main ancestry, all current-SHA CI checks and logs.
5. Update final test evidence, PR title/body with Fixes #138, Fixes #136, Fixes #137;
   mark #139 ready. Keep PR unmerged.
