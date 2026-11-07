"""Regression coverage for runner pins and transient link checking."""

from pathlib import Path

import pytest

from tests.test_recheck_broken_links import module, run_script
from tests.workflow_helpers import WORKFLOWS


def test_workflows_pin_runner_os() -> None:
    for path in WORKFLOWS.glob("*.y*ml"):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if not line.lstrip().startswith("#"):
                assert not any(
                    label in line
                    for label in ("ubuntu-latest", "windows-latest", "macos-latest")
                ), f"{path}:{number}: pin the runner OS: {line}"


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504, 599])
def test_transient_answer_is_retried(status: int) -> None:
    answers = iter([status, 200])
    result = module.recheck_unanswered(
        ["https://example.com/page"],
        accept="200..=299",
        user_agent="lychee",
        initial_wait_ms=1,
        fetch=lambda *_: next(answers),
    )
    assert result.recovered == ["https://example.com/page"]


def test_backoff_sleeps_between_rounds(monkeypatch) -> None:
    answers = iter([503, 503, 200])
    sleeps = []
    monkeypatch.setattr(module.time, "sleep", sleeps.append)
    module.recheck_unanswered(
        ["https://example.com/page"],
        accept="200..=299",
        user_agent="lychee",
        initial_wait_ms=1000,
        fetch=lambda *_: next(answers),
    )
    assert sleeps == [1, 2]


def test_final_failure_prevents_releasing_gate(tmp_path: Path) -> None:
    # The final URL must still block the gate if every transient URL recovers.
    from tests.test_recheck_broken_links import _head_handler
    from http.server import ThreadingHTTPServer
    import threading

    server = ThreadingHTTPServer(("127.0.0.1", 0), _head_handler({}))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        healthy = f"http://127.0.0.1:{server.server_port}/healthy"
        report = tmp_path / "out.md"
        report.write_text(
            f"* [503] <{healthy}> | Error (cached)\n"
            "* [404] <https://example.com/gone> | Not Found\n"
        )
        output = tmp_path / "github-output"
        recovered = tmp_path / "recovered"
        run_script(
            {
                "LYCHEE_OUTPUT": str(report),
                "GITHUB_OUTPUT": str(output),
                "RECOVERED_OUTPUT": str(recovered),
            }
        )
        assert recovered.read_text() == healthy + "\n"
        assert not output.exists()
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize(
    "marker,detail,status,retryable",
    [
        ("503", "Error (cached)", 503, True),
        ("429", "Too Many Requests", 429, True),
        ("ERROR", "Rejected status code: 502 Bad Gateway", 502, True),
        ("ERROR", "Rejected status code: 404 Not Found", 404, False),
        ("403", "Forbidden", 403, False),
        ("TIMEOUT", "Timeout", None, True),
    ],
)
def test_report_classification(marker, detail, status, retryable) -> None:
    failure = module.parse_lychee_failures(
        f"* [{marker}] <https://example.com/page> | {detail}"
    )[0]
    assert failure.status == status
    assert failure.retryable is retryable


@pytest.mark.parametrize(
    "url,expected",
    [
        (
            "https://github.com/o/r/blob/main/a%20b.py#L1",
            "https://api.github.com/repos/o/r/contents/a%20b.py?ref=main",
        ),
        (
            "https://github.com/o/r/tree/v1/docs?plain=1",
            "https://api.github.com/repos/o/r/contents/docs?ref=v1",
        ),
        (
            "https://github.com/o/r/tree/feature%2Ffix/docs",
            "https://api.github.com/repos/o/r/contents/docs?ref=feature%2Ffix",
        ),
        (
            "https://github.com/o/r/tree/main",
            "https://api.github.com/repos/o/r/contents/?ref=main",
        ),
        ("https://github.com/o/r/issues/1", None),
        ("https://github.com.evil.test/o/r/blob/main/a", None),
        ("https://github.com@evil.test/o/r/blob/main/a", None),
        ("http://github.com/o/r/blob/main/a", None),
        ("https://github.com/o/r/blob/main", None),
    ],
)
def test_contents_url_mapping(url, expected) -> None:
    assert module.github_contents_api_url(url) == expected


@pytest.mark.parametrize("api_status", [200, 302, 403, 404, 429, 503])
@pytest.mark.parametrize("token", ["test-only-token", ""])
def test_api_fallback_only_recovers_success(monkeypatch, api_status, token) -> None:
    from unittest.mock import MagicMock
    import urllib.error

    monkeypatch.setenv("GITHUB_TOKEN", token)
    page = "https://github.com/o/r/blob/main/a.py"

    def head(request, timeout):
        assert request.method == "HEAD"
        assert request.get_header("Authorization") is None
        raise urllib.error.HTTPError(page, 503, "Unavailable", {}, None)

    monkeypatch.setattr(module.urllib.request, "urlopen", head)
    opener = MagicMock()
    opener.open.return_value.__enter__.return_value.status = api_status
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_: opener)
    assert module.default_fetch(page, "test-agent") == (
        200 if api_status == 200 else 503
    )
    request = opener.open.call_args.args[0]
    assert request.method == "GET"
    assert request.full_url == "https://api.github.com/repos/o/r/contents/a.py?ref=main"
    assert request.get_header("Authorization") == (f"Bearer {token}" if token else None)
    assert 0 < opener.open.call_args.kwargs["timeout"] <= 30


@pytest.mark.parametrize(
    "url,status",
    [
        ("https://github.com/o/r/blob/main/a", 404),
        ("https://example.com/o/r/blob/main/a", 503),
    ],
)
def test_no_api_for_final_status_or_other_host(monkeypatch, url, status) -> None:
    from unittest.mock import MagicMock

    response = MagicMock()
    response.__enter__.return_value.status = status
    monkeypatch.setattr(
        module.urllib.request, "urlopen", lambda *_args, **_kw: response
    )
    opener = MagicMock()
    monkeypatch.setattr(module.urllib.request, "build_opener", opener)
    assert module.default_fetch(url, "lychee") == status
    opener.assert_not_called()


def test_api_redirect_is_not_followed() -> None:
    assert (
        module.NoRedirect().redirect_request(
            None, None, 302, "", {}, "https://evil.test"
        )
        is None
    )


def test_budget_stops_requests_mid_round(monkeypatch) -> None:
    now = [0.0]
    calls = []
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])

    def fetch(url, _agent):
        calls.append(url)
        now[0] += 1
        return 503

    result = module.recheck_unanswered(
        ["https://a.test", "https://b.test"],
        accept="200..=299",
        user_agent="lychee",
        budget_seconds=1,
        fetch=fetch,
    )
    assert calls == ["https://a.test"]
    assert result.recovered == []
    assert [item.status for item in result.still_broken] == [503, None]


def test_persistent_outage_stays_broken_with_capped_backoff(monkeypatch) -> None:
    now = [0.0]
    sleeps = []
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    monkeypatch.setattr(module.time, "sleep", sleep)
    result = module.recheck_unanswered(
        ["https://a.test"],
        accept="200..=299",
        user_agent="lychee",
        budget_seconds=100,
        initial_wait_ms=20000,
        fetch=lambda *_: 503,
    )
    assert sleeps == [20, 30, 30]
    assert result.recovered == []
    assert result.still_broken[0].status == 503


def test_recovered_transient_duplicates_release_gate(tmp_path, monkeypatch) -> None:
    report = tmp_path / "report"
    report.write_text("* [503] <https://a.test> | Error (cached)\n" * 2)
    monkeypatch.setenv("LYCHEE_OUTPUT", str(report))
    monkeypatch.setenv("RECOVERED_OUTPUT", str(tmp_path / "recovered"))
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "output"))
    monkeypatch.setattr(module, "default_fetch", lambda *_: 200)
    assert module.main() == 0
    assert (tmp_path / "output").read_text() == "all_recovered=true\n"
    assert (tmp_path / "recovered").read_text() == "https://a.test\n"


def test_conflicting_final_entry_is_not_recovered(tmp_path, monkeypatch) -> None:
    report = tmp_path / "report"
    report.write_text(
        "* [503] <https://a.test> | Cached\n* [404] <https://a.test> | Missing\n"
    )
    recovered = tmp_path / "recovered"
    recovered.write_text("https://a.test\n")
    monkeypatch.setenv("LYCHEE_OUTPUT", str(report))
    monkeypatch.setenv("RECOVERED_OUTPUT", str(recovered))
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "output"))

    def fetch(*_):
        pytest.fail("Final failures must not be retried")

    monkeypatch.setattr(module, "default_fetch", fetch)
    module.main()
    assert recovered.read_text() == ""
    assert not (tmp_path / "output").exists()


@pytest.mark.parametrize(
    "error",
    [
        OSError("reset"),
        module.urllib.error.HTTPError(
            "https://api.github.com/repos/o/r/contents/a?ref=main",
            404,
            "Missing",
            {},
            None,
        ),
    ],
)
def test_api_failure_retains_original_transient_status(monkeypatch, error) -> None:
    from unittest.mock import MagicMock

    response = MagicMock()
    response.__enter__.return_value.status = 503
    monkeypatch.setattr(
        module.urllib.request, "urlopen", lambda *_args, **_kw: response
    )
    opener = MagicMock()
    opener.open.side_effect = error
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_: opener)
    assert module.default_fetch("https://github.com/o/r/blob/main/a", "lychee") == 503


def test_request_timeout_uses_remaining_budget(monkeypatch) -> None:
    timeouts = []

    def fetch(_url, _agent, timeout):
        timeouts.append(timeout)
        return 200

    monkeypatch.setattr(module, "default_fetch", fetch)
    result = module.recheck_unanswered(
        ["https://a.test"],
        accept="200..=299",
        user_agent="lychee",
        budget_seconds=0.5,
    )
    assert result.recovered == ["https://a.test"]
    assert 0 < timeouts[0] <= 0.5
