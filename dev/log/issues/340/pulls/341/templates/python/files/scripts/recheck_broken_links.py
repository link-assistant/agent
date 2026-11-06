#!/usr/bin/env python3
"""Re-check transport failures and transient HTTP failures from lychee.

429 and 5xx responses (including cached errors) are retried with exponential
backoff capped at 30 seconds. Other status-coded failures remain final.
Throttled github.com blob/tree pages can recover through a successful
Contents API GET, authenticated when GITHUB_TOKEN is available.

Environment variables:
    LYCHEE_OUTPUT: report path (default lychee/out.md)
    RECOVERED_OUTPUT: recovered URLs (default lychee/recovered.txt)
    RECHECK_BUDGET_SECONDS: shared wall-clock budget (default 240)
    RECHECK_WAIT_MS: initial backoff between rounds (default 2000)
    RECHECK_VERBOSE: true enables per-attempt diagnostics (default off)
    GITHUB_TOKEN: optional token sent only to the GitHub Contents API

The all_recovered output is true only when every failure recovers. Consumers
must test != 'true' so a skipped or crashed step fails safe. Exit code 0
preserves the existing workflow's responsibility for the final failure gate.
"""

from __future__ import annotations

import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

BUDGET_SECONDS_DEFAULT = 240
INITIAL_WAIT_MS_DEFAULT = 2000
REQUEST_TIMEOUT_SECONDS = 30
# lychee's documented default --accept list and --user-agent; used when the
# workflow does not set the flags. tests/test_recheck_broken_links.py reads
# this file and the workflow together, so the two cannot drift apart.
ACCEPT_DEFAULT = "100..=103,200..=299"
USER_AGENT_DEFAULT = "lychee"
WORKFLOW_PATH = Path(".github/workflows/links.yml")

ENTRY_PATTERN = re.compile(
    r"^\s*(?:\*|-)\s+\[([^\]]+)\]\s+<?([^\s>|)]+)>?"
    r"(?:\s+\(at [^)]*\))?\s*\|?\s*(.*)$",
    re.MULTILINE,
)


@dataclass(frozen=True)
class LycheeFailure:
    """One failure entry from the lychee markdown report."""

    marker: str
    url: str
    detail: str
    answered: bool
    status: int | None = None

    @property
    def retryable(self) -> bool:
        """Transport errors and 429/5xx answers can be retried."""
        return not self.answered or is_transient_status(self.status)


@dataclass(frozen=True)
class StillBroken:
    """A URL the re-check could not recover."""

    url: str
    status: int | None
    reason: str


@dataclass(frozen=True)
class RecheckResult:
    """Outcome of retrying transport and transient HTTP failures."""

    recovered: list[str]
    still_broken: list[StillBroken]


def parse_lychee_failures(content: str) -> list[LycheeFailure]:
    """Parse status-coded and transport errors, including cached failures."""
    failures: list[LycheeFailure] = []
    for match in ENTRY_PATTERN.finditer(content):
        marker = match.group(1).strip()
        url = match.group(2).strip().rstrip(".,;!?")
        detail = match.group(3).strip()
        if not url:
            continue
        answered = bool(re.fullmatch(r"\d{3}", marker)) or bool(
            re.search(r"rejected status code", detail, re.IGNORECASE)
        )
        status_match = re.fullmatch(r"\d{3}", marker) or re.search(
            r"rejected status code:\s*(\d{3})", detail, re.IGNORECASE
        )
        status = (
            int(status_match.group(0) if marker.isdigit() else status_match.group(1))
            if status_match
            else None
        )
        failures.append(LycheeFailure(marker, url, detail, answered, status))
    return failures


def parse_accept_ranges(spec: str) -> Callable[[int], bool]:
    """Build an "is this status accepted" predicate from a lychee --accept list.

    Accepts the lychee syntax ``100..=103,200..=299,429`` with stray spaces.
    """
    accepted: set[int] = set()
    for part in spec.split(","):
        trimmed = part.strip()
        if not trimmed:
            continue
        range_match = re.fullmatch(r"(\d+)\.\.=(\d+)", trimmed)
        if range_match:
            accepted.update(
                range(int(range_match.group(1)), int(range_match.group(2)) + 1)
            )
        elif re.fullmatch(r"\d{3}", trimmed):
            accepted.add(int(trimmed))
    return lambda status: status in accepted


def extract_lychee_request_options(workflow_text: str) -> tuple[str, str]:
    """Extract the --accept list and --user-agent the lychee step runs with.

    The re-check must judge a URL by the same rules the checker used, so a
    link lychee would have accepted is accepted here too.
    """
    accept = re.search(r"--accept[=\s]+[\"']?([^\s\"']+)[\"']?", workflow_text)
    user_agent = re.search(r"--user-agent[=\s]+[\"']?([^\s\"']+)[\"']?", workflow_text)
    return (
        accept.group(1) if accept else ACCEPT_DEFAULT,
        user_agent.group(1) if user_agent else USER_AGENT_DEFAULT,
    )


def is_transient_status(status: int | None) -> bool:
    """429 and server errors mean try again, rather than a final rejection."""
    return status is not None and (status == 429 or 500 <= status <= 599)


def github_contents_api_url(url: str) -> str | None:
    """Map a GitHub blob/tree URL to a file/directory lookup at its ref.

    Slash-containing refs must be percent-encoded in their URL segment;
    unencoded slash-containing refs are ambiguous and are not guessed.
    """
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com":
        return None
    parts = parsed.path.strip("/").split("/")
    if len(parts) < 4 or parts[2] not in {"blob", "tree"}:
        return None
    owner, repo, _, ref, *path = parts
    if not owner or not repo or not ref or (parts[2] == "blob" and not path):
        return None

    def quote_segment(value: str) -> str:
        return urllib.parse.quote(urllib.parse.unquote(value), safe="")

    contents = "/".join(quote_segment(part) for part in path)
    return (
        f"https://api.github.com/repos/{quote_segment(owner)}/{quote_segment(repo)}"
        f"/contents/{contents}?ref={quote_segment(ref)}"
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Do not forward an API credential to a redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def default_fetch(
    url: str, user_agent: str, timeout: float = REQUEST_TIMEOUT_SECONDS
) -> int:
    """HEAD a URL, using the Contents API when a GitHub page is throttled."""
    deadline = time.monotonic() + timeout
    request = urllib.request.Request(
        url, method="HEAD", headers={"User-Agent": user_agent}
    )
    try:
        with urllib.request.urlopen(  # noqa: S310 - URL comes from the lychee report
            request, timeout=timeout
        ) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
    api_url = github_contents_api_url(url) if is_transient_status(status) else None
    remaining = deadline - time.monotonic()
    if api_url and remaining > 0:
        headers = {"User-Agent": user_agent, "Accept": "application/vnd.github+json"}
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        api_request = urllib.request.Request(api_url, method="GET", headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect()).open(
                api_request, timeout=remaining
            ) as response:
                if response.status == 200:
                    return 200
        except urllib.error.HTTPError as error:
            error.close()
        except (OSError, ValueError):
            pass  # A failed fallback never proves the original URL healthy.
    return status


def recheck_unanswered(
    urls: list[str],
    *,
    accept: str,
    user_agent: str,
    budget_seconds: float = BUDGET_SECONDS_DEFAULT,
    initial_wait_ms: float = INITIAL_WAIT_MS_DEFAULT,
    fetch: Callable[[str, str], int] | None = None,
) -> RecheckResult:
    """Retry round-robin within a shared budget, backing off between rounds."""
    is_accepted = parse_accept_ranges(accept)
    deadline = time.monotonic() + budget_seconds
    wait_ms = initial_wait_ms

    recovered: list[str] = []
    rejected: list[StillBroken] = []
    pending = list(dict.fromkeys(urls))
    first_round = True
    last_status: dict[str, int] = {}

    while pending and time.monotonic() < deadline:
        if not first_round:
            delay = min(wait_ms / 1000, 30)
            if time.monotonic() + delay >= deadline:
                break
            time.sleep(delay)
            wait_ms *= 2
        first_round = False

        still_pending: list[str] = []
        for index, url in enumerate(pending):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                still_pending.extend(pending[index:])
                break
            try:
                status = (
                    fetch(url, user_agent)
                    if fetch
                    else default_fetch(
                        url, user_agent, min(REQUEST_TIMEOUT_SECONDS, remaining)
                    )
                )
            except Exception:  # noqa: BLE001 - no answer this round, whatever the cause
                if os.environ.get("RECHECK_VERBOSE") == "true":
                    print(f"Re-check: {url}: transport failure")
                still_pending.append(url)
                continue
            last_status[url] = status
            if os.environ.get("RECHECK_VERBOSE") == "true":
                print(f"Re-check: {url}: status {status}")
            if is_accepted(status):
                recovered.append(url)
            elif is_transient_status(status):
                still_pending.append(url)
            else:
                rejected.append(
                    StillBroken(
                        url, status, f"answered {status}, which lychee does not accept"
                    )
                )
        pending = still_pending

    return RecheckResult(
        recovered=recovered,
        still_broken=rejected
        + [
            StillBroken(
                url,
                last_status.get(url),
                "no answer accepted within the re-check budget",
            )
            for url in pending
        ],
    )


def set_github_output(name: str, value: str) -> None:
    """Publish a GitHub Actions step output when a sink is configured."""
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with Path(output_file).open("a", encoding="utf-8") as stream:
            stream.write(f"{name}={value}\n")


def main() -> int:
    """Retry every eligible failure in the configured lychee report."""
    lychee_output = Path(os.environ.get("LYCHEE_OUTPUT", "lychee/out.md"))
    recovered_output = Path(os.environ.get("RECOVERED_OUTPUT", "lychee/recovered.txt"))
    accept, user_agent = extract_lychee_request_options(
        WORKFLOW_PATH.read_text(encoding="utf-8")
    )
    failures = parse_lychee_failures(lychee_output.read_text(encoding="utf-8"))

    final = [
        failure
        for failure in failures
        if not failure.retryable
        or not failure.url.lower().startswith(("http://", "https://"))
    ]
    final_urls = {failure.url for failure in final}
    unanswered = list(
        dict.fromkeys(
            [
                failure.url
                for failure in failures
                if failure.retryable
                and failure.url not in final_urls
                and failure.url.lower().startswith(("http://", "https://"))
            ]
        )
    )
    print(
        f"Re-check: {len(failures)} lychee failure(s), {len(final)} "
        f"final, {len(unanswered)} eligible for retry"
    )
    if recovered_output.exists():
        recovered_output.write_text("", encoding="utf-8")
    if not unanswered:
        print("Re-check: nothing to re-ask.")
        return 0

    result = recheck_unanswered(
        unanswered,
        accept=accept,
        user_agent=user_agent,
        budget_seconds=float(
            os.environ.get("RECHECK_BUDGET_SECONDS", BUDGET_SECONDS_DEFAULT)
        ),
        initial_wait_ms=float(
            os.environ.get("RECHECK_WAIT_MS", INITIAL_WAIT_MS_DEFAULT)
        ),
    )

    for url in result.recovered:
        print(
            f"::notice::{url} failed lychee but answers {accept} now "
            "-- not a broken link"
        )
    if result.recovered:
        recovered_output.parent.mkdir(parents=True, exist_ok=True)
        recovered_output.write_text(
            "\n".join(result.recovered) + "\n", encoding="utf-8"
        )
    print(
        f"Re-check finished: {len(result.recovered)} recovered, "
        f"{len(result.still_broken)} still broken"
    )

    if (
        not final
        and not result.still_broken
        and len(result.recovered) == len(unanswered)
    ):
        set_github_output("all_recovered", "true")
    return 0


if __name__ == "__main__":
    # The re-check only ever downgrades failures, so any crash here must not
    # mask itself as a verdict: exit 0 in every case.
    try:
        sys.exit(main())
    except Exception as error:  # noqa: BLE001 - no crash may raise the gate
        print(f"Re-check crashed (treating as no recovery): {error}")
        sys.exit(0)
