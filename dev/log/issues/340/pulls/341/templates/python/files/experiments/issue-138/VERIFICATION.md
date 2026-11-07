# Verification evidence

## Original defects

`python experiments/issue-138/reproduce_original.py` reads the original helpers
at `78f2fdf5e085871387555bc066071f0aedd24479` using Git and mocks every release
operation. `original-reproduction.log` records all four reproduced gaps:
transient classification, hidden extraction errors, version-only recovery,
and unvalidated rebase.

## Focused automated checks

- `pytest tests/test_release_integrity.py tests/test_version_and_commit.py -o addopts='' -q`: 106 passed.
- `pytest tests/test_check_codeql_results.py -o addopts='' -q`: 75 passed.
- `tests/test_release_workflow.py`: 27 passed in the focused verification run.
- `ruff check scripts tests experiments/issue-138` and `ruff format --check scripts tests experiments/issue-138`: passed.
- `python scripts/check_file_size.py` and `git diff --check`: passed.
- `PATH="$PWD/.venv/bin:$PATH" python experiments/issue-138/verify_uv_lock.py`:
  real uv 0.13.7 refreshes a finite dependency-free project lock offline;
  only the local project version changes. No network or dependency builds.
- The full test suite, builds, docs and workflow/security checks are exercised
  by existing CI rather than duplicated locally.

Release tests use small local repositories/bare remotes, parameterized for root
and nested `python/` layouts. They cover matching/different-version source and
lock drift, changes outside the package, file modes, fragments, validated-parent
loss and merges, clean-checkout recovery, equivalent remote adoption, detached
HEAD publication, failed rebase handling, and a second race during rebase.

## CI investigation and correction

The initial implementation commit `38e9071` ran at 2026-11-06 06:15:13 UTC.
[Security run 42173259443](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/actions/runs/42173259443)
failed both CodeQL gates because valid `level: "none"` success notifications
contain `message: {"text": ""}`. This was a validator bug, not an extraction
failure. The downloaded full log is preserved locally in
`ci-logs/security-42173259443.log` (4987 lines); lines 2172 and 4524 show the
Python and Actions success records that triggered the failure.

The validator now accepts empty informational strings while retaining missing
message/type/severity checks. Four CLI regressions cover both levels and both
notification arrays. Both real SARIF artifacts from that run were downloaded
and rechecked with the corrected gate: `Checked 2 CodeQL report(s): 0
finding(s)/error(s).` The final PR description records current-commit CI results.

Final review also bound push publication to `HEAD:refs/heads/<branch>` so a
detached checkout publishes the attested commit rather than a stale local branch.
No force push, rule bypass or release publication was performed during development.
