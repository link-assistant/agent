# Issue #337: evidence and analysis

Working folder for [issue #337](https://github.com/link-assistant/agent/issues/337)
("Check for all false positives, false negatives, warnings and errors in CI/CD
and fix them all") and [pull request #338](https://github.com/link-assistant/agent/pull/338).

This folder holds raw evidence downloaded from GitHub and the analysis derived
from it. None of it ships in the npm package or the crate. It lets the next
person re-check every claim without re-running the pipeline.

## Contents

| Path                                               | What it is                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`ci-logs/`](ci-logs)                              | Full `gh run view --log` output for every workflow run on `008ec1c` (the commit the issue reports), plus the earlier failing Dependency Freshness run              |
| [`meta/`](meta)                                    | `gh run view --json` metadata, the check runs and annotations of `008ec1c`, a warning sweep over all logs, and a snapshot of hive-mind's `CI-CD-BEST-PRACTICES.md` |
| [`templates/`](templates)                          | Workflow and script inventories of the three pipeline templates at the commits compared against                                                                    |
| [`upstream/`](upstream)                            | Issue reports filed against the templates and the list of their URLs                                                                                               |
| [`timeline.md`](timeline.md)                       | Sequence of events reconstructed from the logs and git history                                                                                                     |
| [`requirements.md`](requirements.md)               | Every requirement of the issue, with status and evidence                                                                                                           |
| [`root-causes.md`](root-causes.md)                 | Each defect: symptom → evidence → root cause → fix → test                                                                                                          |
| [`solution-plans.md`](solution-plans.md)           | The options considered per defect and why one was chosen                                                                                                           |
| [`existing-components.md`](existing-components.md) | Existing tools and libraries surveyed, and which were adopted                                                                                                      |
| [`open-findings.md`](open-findings.md)             | Findings not fixed here, with reasoning and the action they need                                                                                                   |

## How the evidence was collected

```bash
SHA=008ec1c
for RUN in $(gh run list --repo link-assistant/agent --commit "$SHA" --json databaseId --jq '.[].databaseId'); do
  gh run view "$RUN" --repo link-assistant/agent --log > "ci-logs/<workflow>-$RUN.log"
  gh run view "$RUN" --repo link-assistant/agent \
    --json conclusion,createdAt,displayTitle,headSha,jobs,workflowName > "meta/run-$RUN.json"
done
gh run view 39827151731 --repo link-assistant/agent --log-failed > ci-logs/js-39827151731-failed.log
gh api "repos/link-assistant/agent/commits/$SHA/check-runs" --paginate \
  --jq '.check_runs[] | [.id, .name, .conclusion, .output.annotations_count] | @tsv' > meta/check-runs-$SHA.tsv
# Annotations of every check run with at least one annotation:
gh api "repos/link-assistant/agent/check-runs/<id>/annotations" \
  --jq '.[] | "[\(.title // "")] \(.annotation_level) : \(.message)"'  >> meta/annotations-$SHA.txt
# Every line that says warn/deprecat/error, counted per job, for the warning sweep:
grep -iE 'warn|deprecat|##\[error\]' ci-logs/*.log | sort | uniq -c | sort -rn > meta/warning-sweep.txt
```

## Experiments

The reproductions behind the upstream reports are in
[`experiments/issue-337/`](../../../../../../experiments/issue-337) at the repository root:

- `template-gate-pr-supersede.sh`
- `template-gate-needs-comment.sh`
- `template-gate-fork-head.sh`

Each takes a template clone as its first argument.
