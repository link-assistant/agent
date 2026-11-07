"""Tests for scripts/preflight-credentials.sh (issues #74 and #77).

The probes are exercised against a local fake of the three endpoints in play
(GitHub's OIDC provider, PyPI's mint-token endpoint, Docker Hub's registry) so
the rules -- report every failure, unknown is never a pass, probe with a write
-- can be tested without touching real infrastructure.
"""

from __future__ import annotations

import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "preflight-credentials.sh"


class FakeEndpoints:
    """A scriptable fake of the OIDC, PyPI, and Docker Hub endpoints."""

    def __init__(self) -> None:
        self.oidc_status = 200
        self.mint_status = 200
        self.mint_body = "{}"
        self.project_status = 200
        self.auth_status = 200
        self.blob_status = 202
        self.requests: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._build_handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _log(self, method: str, path: str) -> None:
        self.requests.append((method, path))

    def _build_handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass

            def _respond(self, status: int, body: str = "", headers=None) -> None:
                self.send_response(status)
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body.encode())))
                self.end_headers()
                if body:
                    self.wfile.write(body.encode())

            def do_GET(self) -> None:  # noqa: N802
                fake._log("GET", self.path)
                if self.path.startswith("/oidc"):
                    self._respond(
                        fake.oidc_status,
                        json.dumps({"count": 1, "value": "fake-oidc-jwt"}),
                    )
                elif self.path.startswith("/token"):
                    if fake.auth_status == 200:
                        self._respond(200, json.dumps({"token": "registry-jwt"}))
                    else:
                        self._respond(fake.auth_status)
                elif self.path.startswith("/pypi/"):
                    self._respond(fake.project_status)
                else:
                    self._respond(404)

            def do_POST(self) -> None:  # noqa: N802
                fake._log("POST", self.path)
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
                if self.path.startswith("/_/oidc/mint-token"):
                    if fake.mint_status == 200:
                        self._respond(
                            200, json.dumps({"token": "pypi-short-lived-token"})
                        )
                    else:
                        self._respond(fake.mint_status, fake.mint_body)
                elif "/blobs/uploads/" in self.path:
                    headers = {}
                    if fake.blob_status == 202:
                        headers["Location"] = (
                            f"{fake.url}/v2/{fake.image}/blobs/uploads/fake-session"
                        )
                    self._respond(fake.blob_status, "", headers)
                else:
                    self._respond(404)

            def do_DELETE(self) -> None:  # noqa: N802
                fake._log("DELETE", self.path)
                fake.deleted.append(self.path)
                self._respond(204)

        return Handler

    image = "example/app"


@pytest.fixture()
def fake_endpoints():
    fake = FakeEndpoints()
    yield fake
    fake.stop()


def run_script(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    import os

    merged_env = {
        **os.environ,
        "PREFLIGHT_MODE": "release",
        "PREFLIGHT_CURL_TIMEOUT": "5",
        **env,
    }
    return subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=ROOT,
        env=merged_env,
        capture_output=True,
        text=True,
        timeout=20,
    )


def pypi_only_env(fake: FakeEndpoints) -> dict[str, str]:
    return {
        "PYPI_API": fake.url,
        "ACTIONS_ID_TOKEN_REQUEST_URL": f"{fake.url}/oidc?audience=github",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "request-token",
    }


def test_release_mode_fails_without_any_credential() -> None:
    """No OIDC token at all is a refused credential, not an unknown."""
    result = run_script({"PREFLIGHT_MODE": "release"})
    assert result.returncode == 1
    assert "FAIL: no OIDC token available" in result.stdout
    assert (
        "::error::release-preflight: refusing to release with 1 refused credential(s)"
        in (result.stdout + result.stderr)
    )


def test_report_mode_reports_failures_without_blocking() -> None:
    result = run_script(
        {
            "PREFLIGHT_MODE": "report",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "",
            "ACTIONS_ID_TOKEN_REQUEST_URL": "",
        }
    )
    assert result.returncode == 0
    assert "FAIL: no OIDC token available" in result.stdout
    assert "::warning::release-preflight:" in result.stdout
    assert "Report mode: the failures above are advisory" in result.stdout


def test_pypi_mint_proves_trusted_publishing(fake_endpoints) -> None:
    fake = fake_endpoints
    result = run_script(pypi_only_env(fake))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASS: PyPI minted a short-lived upload token via trusted publishing" in (
        result.stdout
    )
    assert "Release preflight: 1 verified, 0 failed, 0 unknown" in result.stdout
    assert ("POST", "/_/oidc/mint-token") in fake.requests
    # The audience matters: the token must be requested for pypi.
    oidc_calls = [path for method, path in fake.requests if path.startswith("/oidc")]
    assert "audience=pypi" in oidc_calls[0]


def test_pypi_refusal_fails_the_release(fake_endpoints) -> None:
    fake = fake_endpoints
    fake.mint_status = 403
    result = run_script(pypi_only_env(fake))
    assert result.returncode == 1
    assert "FAIL: PyPI refused to mint an upload token (403)" in result.stdout
    assert "trusted-publisher mapping" in result.stdout


def test_oidc_unreachable_is_unknown_and_never_a_release_pass(fake_endpoints) -> None:
    result = run_script(
        {
            "PYPI_API": fake_endpoints.url,
            "ACTIONS_ID_TOKEN_REQUEST_URL": "http://127.0.0.1:9/oidc?audience=github",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "request-token",
        }
    )
    assert result.returncode == 1
    assert "UNKNOWN" in result.stdout
    assert "::error::release-preflight: verified nothing (1 unknown)" in result.stdout


def test_docker_write_probe_passes_and_cancels_the_session(fake_endpoints) -> None:
    fake = fake_endpoints
    result = run_script(
        {
            **pypi_only_env(fake),
            "DOCKER_AUTH": fake.url,
            "DOCKER_REGISTRY": fake.url,
            "DOCKERHUB_IMAGE": fake.image,
            "DOCKERHUB_USERNAME": "user",
            "DOCKERHUB_TOKEN": "token",
        }
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASS: Docker Hub accepted a blob-upload write" in result.stdout
    assert "(202; upload session cancelled)" in result.stdout
    assert fake.deleted == [f"/v2/{fake.image}/blobs/uploads/fake-session"]
    assert "Release preflight: 2 verified, 0 failed, 0 unknown" in result.stdout


def test_docker_write_refusal_fails_even_with_pypi_ok(fake_endpoints) -> None:
    fake = fake_endpoints
    fake.blob_status = 403
    result = run_script(
        {
            **pypi_only_env(fake),
            "DOCKER_AUTH": fake.url,
            "DOCKER_REGISTRY": fake.url,
            "DOCKERHUB_IMAGE": fake.image,
            "DOCKERHUB_USERNAME": "user",
            "DOCKERHUB_TOKEN": "token",
        }
    )
    assert result.returncode == 1
    assert "FAIL: Docker Hub refused the write" in result.stdout
    assert "would still have succeeded" in result.stdout


def test_every_failure_is_reported_not_just_the_first(fake_endpoints) -> None:
    fake = fake_endpoints
    fake.mint_status = 403
    fake.blob_status = 403
    result = run_script(
        {
            **pypi_only_env(fake),
            "DOCKER_AUTH": fake.url,
            "DOCKER_REGISTRY": fake.url,
            "DOCKERHUB_IMAGE": fake.image,
            "DOCKERHUB_USERNAME": "user",
            "DOCKERHUB_TOKEN": "token",
        }
    )
    assert result.returncode == 1
    assert "FAIL: PyPI refused to mint" in result.stdout
    assert "FAIL: Docker Hub refused the write" in result.stdout


def test_step_summary_receives_the_verdict(fake_endpoints, tmp_path: Path) -> None:
    fake = fake_endpoints
    summary = tmp_path / "summary.md"
    result = run_script(
        {
            **pypi_only_env(fake),
            "GITHUB_STEP_SUMMARY": str(summary),
        }
    )
    assert result.returncode == 0
    written = summary.read_text()
    assert "### Release preflight (release mode)" in written
    assert "| verified | 1 |" in written
    assert "**Verdict: passed**" in written


@pytest.mark.parametrize("code", ["invalid-publisher", "invalid-pending-publisher"])
@pytest.mark.parametrize("project_status", [200, 404, 503])
def test_missing_pypi_publisher_is_actionable(
    fake_endpoints, code, project_status
) -> None:
    fake = fake_endpoints
    fake.mint_status = 422
    fake.project_status = project_status
    fake.mint_body = json.dumps(
        {"errors": [{"code": code, "description": "no corresponding publisher"}]},
        indent=2,
    )
    result = run_script(
        {
            **pypi_only_env(fake),
            "GITHUB_REPOSITORY": "owner/template",
            "GITHUB_WORKFLOW_REF": "owner/template/.github/workflows/release.yml@refs/heads/main",
        }
    )
    assert result.returncode == 1
    assert f"FAIL: PyPI refused to mint an upload token (422 {code}" in result.stdout
    assert (
        "owner=owner, repository=template, workflow=release.yml, environment=(blank)"
        in result.stdout
    )
    if project_status == 200:
        assert "/manage/project/my-package/settings/publishing/" in result.stdout
        assert "rename [project].name in pyproject.toml" in result.stdout
    elif project_status == 404:
        assert "/manage/account/publishing/" in result.stdout
    else:
        assert "project lookup answered 503" in result.stdout
    assert ("GET", "/pypi/my-package/json") in fake.requests
    assert "fake-oidc-jwt" not in result.stdout
    assert "pypi-short-lived-token" not in result.stdout


@pytest.mark.parametrize(
    "body",
    [
        "",
        "not JSON",
        "{}",
        '{"errors":null}',
        '{"errors":[{}]}',
        *[
            json.dumps({"errors": [{"code": code}]})
            for code in (
                "rate-limited",
                "not-enabled",
                "invalid-token",
                "invalid-reuse-token",
                "invalid-payload",
            )
        ],
    ],
)
def test_uncertain_pypi_422_remains_unknown(fake_endpoints, body) -> None:
    fake_endpoints.mint_status = 422
    fake_endpoints.mint_body = body
    result = run_script(pypi_only_env(fake_endpoints))
    assert result.returncode == 1
    assert "UNKNOWN: PyPI answered 422" in result.stdout
    assert "verified nothing (1 unknown)" in result.stdout
    assert "add a GitHub trusted publisher" not in result.stdout


@pytest.mark.parametrize(
    ("status", "verdict"), [(200, "passed"), (403, "failed"), (422, "unverified")]
)
def test_summary_prints_each_overall_verdict(
    fake_endpoints, tmp_path, status, verdict
) -> None:
    fake_endpoints.mint_status = status
    summary = tmp_path / "summary.md"
    run_script({**pypi_only_env(fake_endpoints), "GITHUB_STEP_SUMMARY": str(summary)})
    assert f"**Verdict: {verdict}**" in summary.read_text()
