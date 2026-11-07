"""Drive the dependency graph preflight through a fake GitHub CLI."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/check-dependency-graph.sh"


def run_probe(tmp_path: Path, responses: list[str], event: str = "pull_request"):
    """Each fake gh invocation consumes one response; success is the word OK."""
    fake = tmp_path / "gh"
    fake.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state = Path(os.environ['FAKE_GH_STATE'])
responses = json.loads(state.read_text())
response = responses.pop(0)
state.write_text(json.dumps(responses))
if response == 'OK':
    print('{}')
    sys.exit(0)
print(response, file=sys.stderr)
sys.exit(1)
""")
    fake.chmod(0o755)
    import json

    state = tmp_path / "state.json"
    state.write_text(json.dumps(responses))
    output = tmp_path / "output"
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=15,
        env={
            **os.environ,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "FAKE_GH_STATE": str(state),
            "GITHUB_EVENT_NAME": event,
            "GITHUB_REPOSITORY": "owner/repo",
            "GITHUB_SHA": "a" * 40,
            "GITHUB_OUTPUT": str(output),
            "DEPENDENCY_GRAPH_RETRY_SECONDS": "0",
        },
    )
    return (
        result,
        output.read_text() if output.exists() else "",
        json.loads(state.read_text()),
    )


def test_enabled_graph_passes(tmp_path) -> None:
    result, output, remaining = run_probe(tmp_path, ["OK"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert "enabled=true" in output
    assert not remaining


@pytest.mark.parametrize("event", ["pull_request", "push", "schedule"])
def test_disabled_graph_is_advisory_only_on_prs(tmp_path, event) -> None:
    result, output, remaining = run_probe(
        tmp_path,
        ["gh: Dependency review is not supported on this repository. (HTTP 403)"],
        event,
    )
    assert result.returncode == (0 if event == "pull_request" else 1)
    assert "enabled=false" in output
    assert (
        "::warning::" in result.stdout
        if event == "pull_request"
        else "::error::" in result.stdout
    )
    assert "https://github.com/owner/repo/settings/security_analysis" in result.stdout
    assert "Dependency graph -> Enable" in result.stdout
    assert not remaining


@pytest.mark.parametrize(
    "error",
    [
        "gh: secondary rate limit (HTTP 403)",
        "gh: API rate limit exceeded (HTTP 403)",
        "gh: Bad Gateway (HTTP 502)",
        "network connection refused",
        "gh: Not Found (HTTP 404)",
    ],
)
def test_transient_errors_are_retried_and_never_called_disabled(
    tmp_path, error
) -> None:
    result, output, remaining = run_probe(tmp_path, [error, error, error], "push")
    assert result.returncode == 1
    assert "enabled=unknown" in output
    assert "unknown" in result.stdout
    assert "Dependency graph is disabled" not in result.stdout
    assert not remaining


def test_retry_can_recover(tmp_path) -> None:
    result, output, remaining = run_probe(
        tmp_path, ["gh: Bad Gateway (HTTP 502)", "OK"]
    )
    assert result.returncode == 0
    assert "enabled=true" in output
    assert not remaining
