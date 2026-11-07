"""Tests for scripts/recheck_broken_links.py (issue #78).

lychee's --max-retries cannot retry a connection reset during connect
(lycheeverse/lychee#2297), so a healthy URL behind a RST is reported broken
without a single retry. The re-check asks those URLs again; a failure
carrying a non-transient status code stays final.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "recheck_broken_links.py"

spec = importlib.util.spec_from_file_location("recheck_broken_links", SCRIPT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)  # type: ignore[union-attr]


# A trimmed copy of a real lychee report: summary table, per-input error
# sections, and the redirect section that must not be mistaken for failures.
FIXTURE_REPORT = """
# Link Checker Report

| Status         | Count |
| -------------- | ----- |
| 🔍 Total       | 120   |
| ❓ Unknown     | 0     |
| 🚫 Errors      | 4     |

## Errors per input

### Errors in docs/index.md

* [ERROR] <file:///home/runner/work/repo/repo/docs/api/Some.Type.yml> (at 15:12) | File not found. Check if file exists and path is correct

### Errors in js/index.html

* [ERROR] <error:> (at 10:49) | Cannot resolve root-relative link '/favicon.svg': To resolve root-relative links in local files, provide a root dir

### Errors in README.md

* [404] <https://link-foundation.github.io/missing/csharp/> (at 48:130) | Rejected status code: 404 Not Found
* [404] <https://link-foundation.github.io/missing/rust/> (at 49:62) | Rejected status code: 404 Not Found

## Redirects per input

* https://docs.rs/link-cli --[302]--> https://docs.rs/link-cli/latest/link_cli/
"""


def test_marks_a_failure_carrying_a_status_code_as_final() -> None:
    answered = [f for f in module.parse_lychee_failures(FIXTURE_REPORT) if f.answered]

    assert [f.url for f in answered] == [
        "https://link-foundation.github.io/missing/csharp/",
        "https://link-foundation.github.io/missing/rust/",
    ]
    assert "Rejected status code" in answered[0].detail


def test_marks_error_timeout_unknown_as_never_answered() -> None:
    report = "\n".join(
        [
            "- [ERROR] <https://example.com/reset> | Connection reset by peer",
            "- [TIMEOUT] <https://example.com/slow> | Timeout",
            "- [UNKNOWN] <https://example.com/dark> | Unknown error",
        ]
    )
    failures = module.parse_lychee_failures(report)

    assert all(not f.answered for f in failures)
    assert [f.marker for f in failures] == ["ERROR", "TIMEOUT", "UNKNOWN"]


def test_treats_a_rejected_status_code_as_an_answer_whatever_the_marker() -> None:
    report = (
        "- [ERROR] <https://example.com/gone> | "
        "Rejected status code: 503 Service Unavailable"
    )

    assert module.parse_lychee_failures(report)[0].answered is True


def test_keeps_non_http_failures_out_of_the_recheck_even_when_unanswered() -> None:
    failures = module.parse_lychee_failures(FIXTURE_REPORT)
    unanswerable = [
        f.url
        for f in failures
        if not f.answered and not f.url.lower().startswith(("http://", "https://"))
    ]

    assert sorted(unanswerable) == [
        "error:",
        "file:///home/runner/work/repo/repo/docs/api/Some.Type.yml",
    ]


def test_reads_the_same_accept_list_and_user_agent_as_the_lychee_step() -> None:
    """The re-check judges a URL by the same rules lychee used.

    Neither flag is set in links.yml today, so lychee's documented defaults
    apply on both sides; if either side changes, this test fails until the
    other follows.
    """
    workflow = (ROOT / ".github" / "workflows" / "links.yml").read_text(
        encoding="utf-8"
    )
    accept, user_agent = module.extract_lychee_request_options(workflow)

    assert accept == "100..=103,200..=299"
    assert user_agent == "lychee"
    assert "--accept" not in workflow
    assert "--user-agent" not in workflow


def test_extracts_the_flags_when_the_workflow_sets_them() -> None:
    workflow = "\n".join(
        [
            "        args: >-",
            "          --verbose",
            "          --accept 200..=299,429",
            "          --user-agent my-checker/2.0",
        ]
    )

    assert module.extract_lychee_request_options(workflow) == (
        "200..=299,429",
        "my-checker/2.0",
    )


def test_accept_list_honours_ranges_singles_and_stray_spaces() -> None:
    accepted = module.parse_accept_ranges(" 100..=103 , 200..=299, 429 ")

    assert accepted(100) and accepted(103) and accepted(200)
    assert accepted(299) and accepted(429)
    assert not accepted(104) and not accepted(404)


def test_recovers_a_url_that_answers_accepted() -> None:
    calls: list[tuple[str, str]] = []

    def fetch(url: str, user_agent: str) -> int:
        calls.append((url, user_agent))
        return 200

    result = module.recheck_unanswered(
        ["https://a.example/x"], accept="200..=299", user_agent="lychee", fetch=fetch
    )

    assert result.recovered == ["https://a.example/x"]
    assert result.still_broken == []
    assert calls == [("https://a.example/x", "lychee")]


def test_stops_at_the_first_rejected_answer_and_never_retries_it() -> None:
    calls: list[str] = []

    def fetch(_url: str, _user_agent: str) -> int:
        calls.append(_url)
        return 404

    result = module.recheck_unanswered(
        ["https://a.example/x"],
        accept="200..=299",
        user_agent="lychee",
        budget_seconds=5,
        initial_wait_ms=1,
        fetch=fetch,
    )

    assert len(calls) == 1
    assert result.recovered == []
    assert result.still_broken == [
        module.StillBroken(
            url="https://a.example/x",
            status=404,
            reason="answered 404, which lychee does not accept",
        )
    ]


def test_retries_a_url_that_never_answers_and_takes_a_later_success() -> None:
    calls = 0

    def fetch(_url: str, _user_agent: str) -> int:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise OSError("ECONNRESET")
        return 204

    result = module.recheck_unanswered(
        ["https://a.example/x"],
        accept="200..=299",
        user_agent="lychee",
        budget_seconds=30,
        initial_wait_ms=1,
        fetch=fetch,
    )

    assert calls == 3
    assert result.recovered == ["https://a.example/x"]


def test_gives_up_without_an_answer_once_the_budget_expires() -> None:
    def fetch(_url: str, _user_agent: str) -> int:
        raise OSError("ECONNRESET")

    result = module.recheck_unanswered(
        ["https://a.example/x"],
        accept="200..=299",
        user_agent="lychee",
        budget_seconds=0,
        fetch=fetch,
    )

    assert result.recovered == []
    assert result.still_broken[0].status is None
    assert "no answer" in result.still_broken[0].reason


def test_asks_a_duplicated_url_only_once() -> None:
    calls: list[str] = []

    def fetch(url: str, _user_agent: str) -> int:
        calls.append(url)
        return 200

    result = module.recheck_unanswered(
        ["https://a.example/x", "https://a.example/x"],
        accept="200..=299",
        user_agent="lychee",
        fetch=fetch,
    )

    assert len(calls) == 1
    assert result.recovered == ["https://a.example/x"]


def test_default_fetch_sends_a_head_with_the_configured_user_agent() -> None:
    seen: dict[str, object] = {}

    server = ThreadingHTTPServer(("127.0.0.1", 0), _head_handler(seen))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status = module.default_fetch(
            f"http://127.0.0.1:{server.server_address[1]}/page", "my-checker/2.0"
        )
    finally:
        server.shutdown()
        server.server_close()

    assert status == 200
    assert seen.get("command") == "HEAD"
    assert seen.get("user_agent") == "my-checker/2.0"


def test_default_fetch_reports_a_rejected_status_as_an_answer() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _head_handler({}, status=404))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status = module.default_fetch(
            f"http://127.0.0.1:{server.server_address[1]}/gone", "lychee"
        )
    finally:
        server.shutdown()
        server.server_close()

    assert status == 404


def _head_handler(seen: dict[str, object], status: int = 200):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def do_HEAD(self) -> None:  # noqa: N802
            seen["command"] = self.command
            seen["user_agent"] = self.headers.get("User-Agent")
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

    return Handler


def run_script(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    import os

    merged_env = {**os.environ, **env}
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        cwd=ROOT,
        env=merged_env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_recheck_step_recovers_only_healthy_urls_and_never_reasks_a_404(
    tmp_path: Path,
) -> None:
    requests: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def do_HEAD(self) -> None:  # noqa: N802
            requests.append(self.path)
            self.send_response(200 if self.path == "/healthy" else 404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        report = tmp_path / "out.md"
        report.write_text(
            "\n".join(
                [
                    "## Errors per input",
                    f"- [ERROR] <{base}/healthy> | Connection reset by peer",
                    f"- [ERROR] <{base}/dead> | Connection reset by peer",
                    "- [404] <https://example.com/final/> | Rejected status code: 404 Not Found",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        recovered_path = tmp_path / "recovered.txt"
        output_path = tmp_path / "github-output.txt"

        result = run_script(
            {
                "LYCHEE_OUTPUT": str(report),
                "RECOVERED_OUTPUT": str(recovered_path),
                "GITHUB_OUTPUT": str(output_path),
                "RECHECK_WAIT_MS": "10",
                "RECHECK_BUDGET_SECONDS": "30",
            }
        )

        assert result.returncode == 0, result.stdout + result.stderr
        assert recovered_path.read_text(encoding="utf-8") == f"{base}/healthy\n"
        # The 404 was already an answer; re-asking it would be wrong.
        assert sorted(requests) == ["/dead", "/healthy"]
        # One link stayed broken, so the gate must not be released.
        assert not output_path.exists()
        assert "still broken" in result.stdout
    finally:
        server.shutdown()
        server.server_close()


def test_releases_the_gate_only_when_every_unanswered_link_recovered(
    tmp_path: Path,
) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _head_handler({}, status=200))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        report = tmp_path / "out.md"
        report.write_text(f"- [TIMEOUT] <{base}/slow> | Timeout\n", encoding="utf-8")
        recovered_path = tmp_path / "recovered.txt"
        output_path = tmp_path / "github-output.txt"

        result = run_script(
            {
                "LYCHEE_OUTPUT": str(report),
                "RECOVERED_OUTPUT": str(recovered_path),
                "GITHUB_OUTPUT": str(output_path),
                "RECHECK_WAIT_MS": "10",
                "RECHECK_BUDGET_SECONDS": "30",
            }
        )

        assert result.returncode == 0, result.stdout + result.stderr
        assert "all_recovered=true" in output_path.read_text(encoding="utf-8")
    finally:
        server.shutdown()
        server.server_close()


def test_exits_0_even_when_the_report_is_missing_entirely(tmp_path: Path) -> None:
    result = run_script(
        {
            "LYCHEE_OUTPUT": str(tmp_path / "missing.md"),
            "RECOVERED_OUTPUT": str(tmp_path / "recovered.txt"),
        }
    )

    assert result.returncode == 0
    assert "treating as no recovery" in result.stdout + result.stderr


def test_nothing_to_reask_when_every_failure_carrying_a_status(tmp_path: Path) -> None:
    report = tmp_path / "out.md"
    report.write_text(
        "* [404] https://example.com/missing | Rejected status code: 404 Not Found\n",
        encoding="utf-8",
    )

    result = run_script({"LYCHEE_OUTPUT": str(report)})

    assert result.returncode == 0
    assert "nothing to re-ask" in result.stdout


def test_recheck_never_raises_a_failure(tmp_path: Path) -> None:
    """A bogus report must downgrade to no recovery, never fail the step."""
    report = tmp_path / "out.md"
    report.write_text("not a lychee report at all\n", encoding="utf-8")

    result = run_script({"LYCHEE_OUTPUT": str(report)})

    assert result.returncode == 0
