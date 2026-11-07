"""Exercise the SARIF gate through its real command-line exit status."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/check_codeql_results.py"


def report(results=None, **run_fields):
    return {
        "version": "2.1.0",
        "runs": [
            {
                "tool": {"driver": {"name": "CodeQL"}},
                "results": results or [],
                **run_fields,
            }
        ],
    }


def gate(path):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )


def test_accepts_multiple_clean_reports_and_runs(tmp_path):
    payload = report(invocations=[{"executionSuccessful": True}])
    payload["runs"].append(report()["runs"][0])
    (tmp_path / "python.sarif").write_text(json.dumps(payload))
    (tmp_path / "actions.sarif").write_text(json.dumps(report()))
    assert gate(tmp_path).returncode == 0


@pytest.mark.parametrize("level", ["error", "warning", "note", "none", None])
def test_rejects_every_finding_level_in_later_files_and_runs(tmp_path, level):
    finding = {"ruleId": "example/rule", "message": {"text": "finding"}}
    if level is not None:
        finding["level"] = level
    payload = report()
    payload["runs"].append(report([finding])["runs"][0])
    (tmp_path / "a-clean.sarif").write_text(json.dumps(report()))
    (tmp_path / "z-findings.sarif").write_text(json.dumps(payload))
    result = gate(tmp_path)
    assert result.returncode != 0
    assert "example/rule" in result.stdout


@pytest.mark.parametrize(
    "payload",
    [
        "not-json",
        [],
        {},
        {"version": "2.1.0", "runs": []},
        {"version": "2.1.0", "runs": [None]},
        report(invocations=[{"executionSuccessful": False}]),
        report(invocations=[{}]),
        report(results="bad"),
        report(tool={}),
        report(tool={"driver": {"name": 42}}),
        report(tool={"driver": {"name": "   "}}),
    ],
)
def test_rejects_invalid_or_unsuccessful_reports(tmp_path, payload):
    (tmp_path / "invalid.sarif").write_text(
        payload if isinstance(payload, str) else json.dumps(payload)
    )
    assert gate(tmp_path).returncode != 0


def test_rejects_missing_reports(tmp_path):
    assert gate(tmp_path).returncode != 0
    assert gate(tmp_path / "missing").returncode != 0


NOTIFICATION_KEYS = ["toolExecutionNotifications", "toolConfigurationNotifications"]


@pytest.mark.parametrize("key", NOTIFICATION_KEYS)
@pytest.mark.parametrize("level", ["error", "warning", None, "unknown", 1, []])
def test_rejects_notifications_despite_successful_execution(tmp_path, key, level):
    notification = {
        "descriptor": {"id": "extractor/failure"},
        "message": {"text": "Extraction failed"},
        "locations": [
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": "src/example.py"},
                    "region": {"startLine": 42},
                }
            }
        ],
    }
    if level is not None:
        notification["level"] = level
    payload = report(
        invocations=[
            {"executionSuccessful": True},
            {"executionSuccessful": True, key: [notification]},
        ]
    )
    (tmp_path / "extraction.sarif").write_text(json.dumps(payload))
    result = gate(tmp_path)
    assert result.returncode != 0
    for detail in (
        key,
        "extractor/failure",
        "src/example.py",
        "42",
        "Extraction failed",
    ):
        assert detail in result.stdout


@pytest.mark.parametrize("key", NOTIFICATION_KEYS)
@pytest.mark.parametrize(
    "notifications",
    [
        None,
        {},
        "bad",
        [None],
        [1],
        [[]],
        [{}],
        [{"level": "note"}],
        [{"level": "none", "message": "bad"}],
        [{"level": "note", "message": {"text": 42}}],
        [{"level": "note", "message": {"text": "ok"}, "locations": "bad"}],
        [{"level": "note", "message": {"text": "ok"}, "descriptor": []}],
    ],
)
def test_rejects_malformed_notification_evidence(tmp_path, key, notifications):
    payload = report(invocations=[{"executionSuccessful": True, key: notifications}])
    (tmp_path / "malformed.sarif").write_text(json.dumps(payload))
    assert gate(tmp_path).returncode != 0


@pytest.mark.parametrize("key", NOTIFICATION_KEYS)
@pytest.mark.parametrize("level", ["note", "none"])
def test_allows_informational_notifications(tmp_path, key, level):
    payload = report(
        invocations=[
            {
                "executionSuccessful": True,
                key: [
                    {"level": level, "message": {"text": "Analysis progress"}},
                    {"level": level, "message": {"id": "localizedMessage"}},
                ],
            }
        ]
    )
    (tmp_path / "information.sarif").write_text(json.dumps(payload))
    assert gate(tmp_path).returncode == 0


@pytest.mark.parametrize("key", NOTIFICATION_KEYS)
@pytest.mark.parametrize(
    "fields",
    [
        {"descriptor": {"id": 1, "index": 0}},
        {"descriptor": {"index": True}},
        {"associatedRule": "bad"},
        {"locations": [{"physicalLocation": {"artifactLocation": {"uri": 1}}}]},
        {"locations": [{"physicalLocation": {"region": {"startLine": "42"}}}]},
        {"message": {"text": "ok", "arguments": [1]}},
    ],
)
def test_informational_level_does_not_hide_malformed_diagnostic_fields(
    tmp_path, key, fields
):
    notification = {"level": "note", "message": {"text": "info"}, **fields}
    (tmp_path / "malformed.sarif").write_text(
        json.dumps(
            report(
                invocations=[
                    {"executionSuccessful": True, key: [notification]},
                ]
            )
        )
    )
    assert gate(tmp_path).returncode != 0


def test_notification_diagnostics_escape_workflow_commands(tmp_path):
    notification = {
        "level": "error",
        "message": {"text": "failed\n::warning::injected"},
    }
    payload = report()
    payload["runs"].append(
        report(
            invocations=[
                {
                    "executionSuccessful": True,
                    "toolExecutionNotifications": [notification],
                }
            ]
        )["runs"][0]
    )
    (tmp_path / "later-run.sarif").write_text(json.dumps(payload))
    result = gate(tmp_path)
    assert result.returncode != 0
    assert "run 2" in result.stdout
    assert "\\n::warning::injected" in result.stdout
    assert "\n::warning::injected" not in result.stdout


@pytest.mark.parametrize("key", NOTIFICATION_KEYS)
@pytest.mark.parametrize("level", ["note", "none"])
def test_accepts_codeql_empty_informational_message(tmp_path, key, level):
    notification = {
        "message": {"text": ""},
        "level": level,
        "descriptor": {
            "id": "py/diagnostics/successfully-extracted-files",
            "index": 1,
            "toolComponent": {"index": 0},
        },
        "locations": [
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": "src/example.py", "index": 0},
                }
            }
        ],
    }
    (tmp_path / "success.sarif").write_text(
        json.dumps(
            report(
                invocations=[
                    {"executionSuccessful": True, key: [notification]},
                ]
            )
        )
    )
    assert gate(tmp_path).returncode == 0
