# Workflow Artifacts

Workflow artifacts were downloaded with `gh run download` for all PR #1833 runs
that published artifacts.

Committed artifact contents:

- `run-24467127145/test-results/`: GUT test output and XML result files for the
  initial PR SHA.
- `run-24467564323/test-results/`: GUT test output and XML result files for the
  final PR SHA.
- `run-24467127151/gdscript-import-log/`: GDScript import log for the initial PR
  SHA.
- `run-24467564352/gdscript-import-log/`: GDScript import log for the final PR
  SHA.

The `windows-build` artifacts were downloaded, hashed, and then removed from
the commit set because each zip file was over GitHub's 100 MB per-file limit:

- Run `24467127133`: `Windows Desktop.zip`, 113,681,042 bytes.
- Run `24467564375`: `Windows Desktop.zip`, 113,678,122 bytes.

Hashes and original file listings are preserved in:

- `windows-build-artifacts.sha256`
- `windows-build-artifacts.files.txt`

To re-download those large artifacts:

```bash
gh run download 24467127133 \
  --repo Jhon-Crow/godot-topdown-MVP \
  --name windows-build \
  --dir docs/case-studies/issue-264/artifacts/run-24467127133

gh run download 24467564375 \
  --repo Jhon-Crow/godot-topdown-MVP \
  --name windows-build \
  --dir docs/case-studies/issue-264/artifacts/run-24467564375
```
