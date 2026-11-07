"""Offline release state and bounded PyPI propagation regressions."""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest


@pytest.fixture
def module():
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    sys.path.insert(0, str(scripts))
    try:
        spec = importlib.util.spec_from_file_location(
            "check_release", scripts / "check_release.py"
        )
        assert spec and spec.loader
        loaded = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loaded)
        yield loaded
    finally:
        sys.path.remove(str(scripts))


@pytest.mark.parametrize("subdirectory", [".", "python"])
@pytest.mark.parametrize(
    "pypi_exists,github_exists",
    [(False, False), (True, False), (False, True), (True, True)],
)
def test_release_decision_uses_both_artifacts(
    module, monkeypatch, tmp_path, subdirectory, pypi_exists, github_exists
) -> None:
    """A tag alone cannot hide a missing PyPI version or GitHub release."""
    root = tmp_path / subdirectory
    root.mkdir(exist_ok=True)
    (root / "pyproject.toml").write_text(
        '[project]\nname = "some-package"\nversion = "1.2.3"\n[tool.scriv]\nversion = "9.9.9"\n'
    )
    seen = []
    monkeypatch.setattr(
        module, "pypi_release_exists", lambda name, version: pypi_exists
    )

    def github_release(repository, tag):
        seen.append((repository, tag))
        return github_exists

    monkeypatch.setattr(module, "github_release_exists", github_release)
    outputs = module.check_release(tmp_path, "owner/repo")
    tag = "v1.2.3" if subdirectory == "." else "py_v1.2.3"
    assert seen == [("owner/repo", tag)]
    assert outputs["tag"] == tag
    assert outputs["current_version"] == "1.2.3"
    assert outputs["package_name"] == "some-package"
    assert outputs["should_release"] == str(not (pypi_exists and github_exists)).lower()


@pytest.mark.parametrize(
    "status,expected",
    [(200, True), (404, False), (403, None), (429, None), (503, None)],
)
def test_registry_probe_does_not_treat_outages_as_absence(
    module, monkeypatch, status, expected
) -> None:
    """Only a definite 404 means an artifact is missing."""
    urls = []

    def request(url, **kwargs):
        urls.append(url)
        return status, {}

    monkeypatch.setattr(module, "request_json", request)
    if expected is None:
        with pytest.raises(module.ReleaseError, match=str(status)):
            module.pypi_release_exists("some-package", "1.2.3")
    else:
        assert module.pypi_release_exists("some-package", "1.2.3") is expected
    assert urls == ["https://pypi.org/pypi/some-package/1.2.3/json"]


@pytest.mark.parametrize(
    "status,draft,expected",
    [
        (200, False, True),
        (200, True, False),
        (404, False, False),
        (403, False, None),
        (500, False, None),
    ],
)
def test_github_probe_checks_a_published_release(
    module, monkeypatch, status, draft, expected
) -> None:
    """A draft or bare tag must not suppress recovery; API errors fail closed."""
    monkeypatch.setenv("GH_TOKEN", "test-token")

    def request(url, **kwargs):
        assert url == "https://api.github.com/repos/owner/repo/releases/tags/py_v1.2.3"
        assert kwargs["token"] == "test-token"
        return status, {"draft": draft}

    monkeypatch.setattr(module, "request_json", request)
    if expected is None:
        with pytest.raises(module.ReleaseError, match=str(status)):
            module.github_release_exists("owner/repo", "py_v1.2.3")
    else:
        assert module.github_release_exists("owner/repo", "py_v1.2.3") is expected


def fake_clock(module, monkeypatch):
    now = [0.0]
    sleeps = []
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    monkeypatch.setattr(module.time, "sleep", sleep)
    return now, sleeps


def test_pypi_wait_survives_lag_beyond_the_old_window(module, monkeypatch) -> None:
    """Virtual time demonstrates a four-minute lag without waiting in tests."""
    now, sleeps = fake_clock(module, monkeypatch)
    calls = []

    def request(url, **kwargs):
        calls.append(kwargs["timeout"])
        return (200 if now[0] >= 240 else 404), {}

    monkeypatch.setattr(module, "request_json", request)
    module.wait_for_pypi("some-package", "1.2.3")
    assert now[0] == 240
    assert len(sleeps) == 16
    assert len(calls) == 17
    assert all(timeout <= 10 for timeout in calls)


@pytest.mark.parametrize("failure", [404, 429, 500, 503, URLError("connection reset")])
def test_wait_has_a_finite_deadline_and_explains_partial_success(
    module, monkeypatch, failure
) -> None:
    """Permanent propagation/network failures stop and allow a safe rerun."""
    now, sleeps = fake_clock(module, monkeypatch)

    def request(url, **kwargs):
        assert kwargs["timeout"] <= 10
        if isinstance(failure, Exception):
            raise module.ReleaseError(str(failure))
        return failure, {}

    monkeypatch.setattr(module, "request_json", request)
    with pytest.raises(module.ReleaseError, match="upload step succeeded"):
        module.wait_for_pypi(
            "some-package", "1.2.3", timeout_seconds=35, interval_seconds=15
        )
    assert now[0] == 35
    assert sleeps == [15, 15, 5]


def test_wait_caps_requests_and_delays_to_remaining_budget(module, monkeypatch) -> None:
    """Request time is included in the propagation budget."""
    now, sleeps = fake_clock(module, monkeypatch)
    timeouts = []

    def request(url, **kwargs):
        timeouts.append(kwargs["timeout"])
        now[0] += kwargs["timeout"]
        return 404, {}

    monkeypatch.setattr(module, "request_json", request)
    with pytest.raises(module.ReleaseError):
        module.wait_for_pypi(
            "some-package", "1.2.3", timeout_seconds=28, interval_seconds=15
        )
    assert timeouts == [10, 3]
    assert sleeps == [15]
    assert now[0] == 28


@pytest.mark.parametrize(
    "timeout,interval",
    [(0, 15), (600, 0), (-1, 15), (float("inf"), 15), (600, float("nan"))],
)
def test_wait_rejects_unbounded_or_invalid_settings(module, timeout, interval) -> None:
    """CLI overrides cannot turn the bounded wait into an infinite loop."""
    with pytest.raises(module.ReleaseError):
        module.wait_for_pypi(
            "some-package", "1.2.3", timeout_seconds=timeout, interval_seconds=interval
        )


def test_wait_does_not_retry_permanent_http_errors(module, monkeypatch) -> None:
    monkeypatch.setattr(module, "request_json", lambda *args, **kwargs: (403, {}))
    with pytest.raises(module.ReleaseError, match="403"):
        module.wait_for_pypi("some-package", "1.2.3")


def test_http_probe_closes_responses_and_never_sends_token_to_pypi(
    module, monkeypatch
) -> None:
    requests = []

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            requests.append("closed")

        def read(self, *args):
            return json.dumps({"draft": False}).encode()

    class Opener:
        def open(self, request, **kwargs):
            requests.append(request)
            assert kwargs["timeout"] == 10
            return Response()

    monkeypatch.setattr(module, "build_opener", lambda *args: Opener())
    module.request_json("https://pypi.org/pypi/pkg/1/json")
    assert requests[0].get_header("Authorization") is None
    assert requests[1] == "closed"
    module.request_json(
        "https://api.github.com/repos/o/r/releases/tags/v1", token="test-token"
    )
    assert requests[2].get_header("Authorization") == "Bearer test-token"


@pytest.mark.parametrize("code", [404, 429, 503])
def test_http_probe_returns_http_status_without_parsing_error_body(
    module, monkeypatch, code
) -> None:
    class Opener:
        def open(self, request, **kwargs):
            raise HTTPError(request.full_url, code, "status", {}, None)

    monkeypatch.setattr(module, "build_opener", lambda *args: Opener())
    assert module.request_json("https://pypi.org/pypi/pkg/1/json") == (code, {})


def test_cli_failure_returns_nonzero_without_success_outputs(
    module, monkeypatch, tmp_path
) -> None:
    outputs = tmp_path / "outputs"
    monkeypatch.setenv("GITHUB_OUTPUT", str(outputs))
    monkeypatch.setattr(
        module,
        "check_release",
        lambda *args: (_ for _ in ()).throw(module.ReleaseError("503")),
    )
    assert module.main(["check", "--repository", "o/r"]) == 1
    assert not outputs.exists()


def test_wait_and_redirect_handling_with_real_local_http(module, monkeypatch) -> None:
    """Exercise urllib responses, transient statuses and redirect rejection offline."""
    statuses = iter([404, 503, 200])
    paths = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            paths.append(self.path)
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/token-target")
                self.end_headers()
                return
            status = next(statuses)
            self.send_response(status)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    try:
        monkeypatch.setattr(module, "pypi_url", lambda *args: f"{endpoint}/version")
        module.wait_for_pypi(
            "test-package", "1.2.3", timeout_seconds=2, interval_seconds=0.01
        )
        assert paths == ["/version"] * 3
        assert module.request_json(f"{endpoint}/redirect", token="test-token")[0] == 302
        assert "/token-target" not in paths
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive()


def test_cli_success_writes_artifact_outputs(module, monkeypatch, tmp_path) -> None:
    output = tmp_path / "outputs"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(
        module,
        "check_release",
        lambda *args: {"should_release": "true", "current_version": "1.2.3"},
    )
    assert module.main(["check", "--repository", "o/r"]) == 0
    assert output.read_text() == "should_release=true\ncurrent_version=1.2.3\n"
