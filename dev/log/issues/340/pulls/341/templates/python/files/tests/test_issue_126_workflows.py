"""Integration policies for full CodeQL scanning and artifact transport."""

from tests.workflow_helpers import (
    WORKFLOWS,
    read_workflow,
    workflow_job_block,
    workflow_step_block,
)


def test_codeql_runs_full_analysis_and_gates_local_results():
    job = workflow_job_block(read_workflow("security.yml"), "codeql")
    assert "CODEQL_ACTION_DIFF_INFORMED_QUERIES: 'false'" in job
    assert "language: [python, actions]" in job
    analyze = workflow_step_block(job, "Analyze")
    assert "output: codeql-results" in analyze
    assert "upload: false" not in analyze
    gate = workflow_step_block(job, "Reject CodeQL findings")
    assert "python scripts/check_codeql_results.py codeql-results" in gate
    assert "continue-on-error" not in job
    evidence = workflow_step_block(job, "Preserve CodeQL reports")
    assert "if: always()" in evidence
    assert "if-no-files-found: error" in evidence
    assert (
        job.index("- name: Analyze")
        < job.index("- name: Reject CodeQL findings")
        < job.index("- name: Preserve CodeQL reports")
    )


def test_every_artifact_operation_uses_transport_wrapper():
    for path in WORKFLOWS.glob("*.yml"):
        workflow = path.read_text()
        for action in (
            "actions/upload-artifact@",
            "actions/download-artifact@",
            "actions/upload-pages-artifact@",
        ):
            assert action not in workflow, (path, action)
