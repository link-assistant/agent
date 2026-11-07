"""Behaviour tests for the execution-budget wrapper (issue #60).

A job killed by ``timeout-minutes`` is reported by GitHub as **cancelled**, not
**failed**, so on a pull request a genuine timeout only produces a warning. The
wrapper exists to take the deadline away from the runner: it must terminate the
whole process tree of an overrun, annotate it as an error naming the budget, and
exit 124 like ``timeout(1)`` so the job concludes ``failure``.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "run-with-budget-warning.sh"


def run_wrapper(
    arguments: list[str], **env: str
) -> tuple[subprocess.CompletedProcess[str], float]:
    """Run the wrapper with the given arguments and return it with its runtime."""
    started = time.monotonic()
    completed = subprocess.run(
        ["bash", str(SCRIPT), *arguments],
        capture_output=True,
        text=True,
        check=False,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", **env},
    )
    return completed, time.monotonic() - started


def is_running(pid: int) -> bool:
    """Return whether a process is still running, ignoring unreaped zombies.

    A grandchild that outlives its parent is reparented, and an init that does
    not reap leaves it as a zombie: terminated, but still addressable by
    ``os.kill(pid, 0)``.
    """
    for _ in range(50):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        state = Path(f"/proc/{pid}/stat")
        if state.exists():
            return (
                state.read_text(encoding="utf-8").rpartition(")")[2].split()[0] != "Z"
            )
        time.sleep(0.1)
    return True


def test_wrapper_is_executable_and_strict() -> None:
    """The wrapper must be runnable directly and abort on the first error."""
    assert SCRIPT.exists()
    assert SCRIPT.stat().st_mode & 0o111
    assert "set -euo pipefail" in SCRIPT.read_text(encoding="utf-8")


def test_command_inside_its_budget_succeeds_and_reports_what_it_spent() -> None:
    """The common case must stay quiet about failure and pass the exit code on."""
    completed, _ = run_wrapper(["30", "Quick step", "true"])

    assert completed.returncode == 0, completed.stderr
    assert "Quick step took" in completed.stdout
    assert "::error" not in completed.stderr

    failing, _ = run_wrapper(["30", "Quick step", "false"])
    assert failing.returncode == 1, failing.stderr


def test_finished_root_cannot_leave_the_callers_output_pipe_open() -> None:
    """A detached worker must not keep ``tee`` or ``subprocess`` waiting for EOF."""
    completed, elapsed = run_wrapper(
        ["30", "Worker probe", "bash", "-c", "sleep 4 & exit 0"],
        BUDGET_POLL_SECONDS="0.1",
    )

    assert completed.returncode == 0, completed.stderr
    assert elapsed < 2, f"a surviving worker held stdout open for {elapsed:.1f}s"


def test_output_relay_preserves_stdout_stderr_and_exit_status() -> None:
    """Capturing descendants internally must stay transparent to callers."""
    completed, _ = run_wrapper(
        [
            "30",
            "Two streams",
            "bash",
            "-c",
            'printf "out-one\\nout-two\\n"; printf "err-one\\nerr-two\\n" >&2; exit 7',
        ],
        BUDGET_POLL_SECONDS="0.1",
    )

    assert completed.returncode == 7
    assert "out-one\nout-two" in completed.stdout
    assert "err-one\nerr-two" in completed.stderr


def test_output_capture_can_be_disabled() -> None:
    """Commands that need their original descriptors retain an escape hatch."""
    completed, _ = run_wrapper(
        ["30", "Direct output", "bash", "-c", "printf direct"],
        BUDGET_CAPTURE_OUTPUT="0",
        BUDGET_POLL_SECONDS="0.1",
    )

    assert completed.returncode == 0, completed.stderr
    assert "direct" in completed.stdout


def test_overrun_is_terminated_and_reported_as_an_error() -> None:
    """An overrun must fail the job instead of running into the job clock."""
    completed, elapsed = run_wrapper(
        ["2", "Runaway suite", "sleep", "120"],
        BUDGET_WARN_RATIO_PERCENT="50",
        BUDGET_GRACE_SECONDS="2",
    )

    assert completed.returncode == 124, completed.stderr
    assert (
        "::error title=Runaway suite exceeded its execution budget::"
        in completed.stderr
    )
    assert "2s execution budget" in completed.stderr
    assert elapsed < 60, (
        f"the wrapper waited {elapsed:.0f}s to enforce a 2s budget; it must not "
        "depend on the job clock to stop a runaway command"
    )


def test_overrun_kills_the_whole_process_tree(tmp_path: Path) -> None:
    """`pytest -n` spawns workers, and orphans would hold the runner open."""
    pid_file = tmp_path / "pids"
    completed, _ = run_wrapper(
        [
            "2",
            "Fan-out step",
            "bash",
            "-c",
            f'echo $$ > "{pid_file}"; sleep 600 & echo $! >> "{pid_file}"; wait',
        ],
        BUDGET_GRACE_SECONDS="2",
    )

    assert completed.returncode == 124, completed.stderr
    pids = [int(line) for line in pid_file.read_text(encoding="utf-8").split()]
    assert len(pids) == 2
    for pid in pids:
        assert not is_running(pid), f"process {pid} outlived the budget"


def test_overrun_escalates_when_sigterm_is_ignored() -> None:
    """A stubborn process receives SIGKILL after the bounded grace period."""
    completed, elapsed = run_wrapper(
        ["1", "Stubborn step", "bash", "-c", "trap '' TERM; sleep 60 & wait"],
        BUDGET_GRACE_SECONDS="1",
        BUDGET_KILL_SECONDS="1",
        BUDGET_POLL_SECONDS="0.1",
    )

    assert completed.returncode == 124, completed.stderr
    assert "sending SIGKILL" in completed.stdout
    assert elapsed < 10


def test_sigkill_still_reaches_worker_after_root_handles_sigterm(
    tmp_path: Path,
) -> None:
    """A root completion status must not hide a stubborn surviving worker."""
    pid_file = tmp_path / "worker-pid"
    command = (
        "trap 'exit 0' TERM; "
        "bash -c 'trap \"\" TERM; sleep 60' & "
        f"echo $! > '{pid_file}'; wait"
    )

    completed, _ = run_wrapper(
        ["1", "Root exits", "bash", "-c", command],
        BUDGET_GRACE_SECONDS="1",
        BUDGET_KILL_SECONDS="1",
        BUDGET_POLL_SECONDS="0.1",
    )

    assert completed.returncode == 124, completed.stderr
    assert "sending SIGKILL" in completed.stdout
    assert not is_running(int(pid_file.read_text(encoding="utf-8")))


def test_warning_arrives_while_the_command_is_still_running() -> None:
    """A post-mortem warning on a killed job is exactly the missing diagnostic."""
    completed, _ = run_wrapper(
        ["4", "Slow suite", "sleep", "2"], BUDGET_WARN_RATIO_PERCENT="30"
    )

    assert completed.returncode == 0, completed.stderr
    assert "::warning title=Slow suite is approaching its timeout::" in completed.stderr


def test_enforcement_has_an_escape_hatch_for_local_runs() -> None:
    """A laptop must not be killed for being slower than a hosted runner."""
    completed, _ = run_wrapper(
        ["1", "Local run", "sleep", "2"],
        BUDGET_ENFORCE="false",
        BUDGET_WARN_RATIO_PERCENT="10",
    )

    assert completed.returncode == 0, completed.stderr
    assert "::warning title=Local run is approaching its timeout::" in completed.stderr
    assert "::error" not in completed.stderr


def test_heartbeat_is_available_but_off_by_default() -> None:
    """Verbose tracing names the command still running when the budget expires."""
    quiet, _ = run_wrapper(
        ["30", "Quiet run", "sleep", "2"], BUDGET_HEARTBEAT_SECONDS="1"
    )
    assert quiet.returncode == 0, quiet.stderr
    assert "[budget]" not in quiet.stderr

    verbose, _ = run_wrapper(
        ["30", "Verbose run", "sleep", "2"],
        BUDGET_HEARTBEAT_SECONDS="1",
        CI_VERBOSE="true",
    )
    assert verbose.returncode == 0, verbose.stderr
    assert "[budget]" in verbose.stderr


def test_missing_arguments_are_rejected() -> None:
    """A misconfigured call must not silently run without a deadline."""
    for arguments in ([], ["30"], ["30", "Label"]):
        completed, _ = run_wrapper(arguments)
        assert completed.returncode != 0
        assert completed.returncode != 124


def test_never_terminates_a_command_that_finishes_inside_its_budget() -> None:
    """Start near a second boundary where SECONDS overreads elapsed time."""
    deadline = time.monotonic() + 3
    while not 0.75 <= time.time() % 1 <= 0.78:
        assert time.monotonic() < deadline, "could not align boundary probe"
        time.sleep(0.001)
    completed, _ = run_wrapper(
        ["2", "Aligned step", "sleep", "1.4"],
        BUDGET_POLL_SECONDS="0.05",
        BUDGET_GRACE_SECONDS="1",
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


@pytest.mark.parametrize("seconds", ["0", "1", "2"])
def test_elapsed_deadlines_require_strictly_greater_seconds(seconds) -> None:
    """The same conservative comparison protects the grace and kill waits."""
    text = SCRIPT.read_text()
    helper = text[text.index("has_elapsed() {") :].split("\n}", 1)[0] + "\n}"
    result = subprocess.run(
        ["bash", "-c", helper + f"\nSECONDS={seconds}; has_elapsed {seconds}"],
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 1
