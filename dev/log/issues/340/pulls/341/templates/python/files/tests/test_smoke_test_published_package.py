"""Tests for scripts/smoke_test_published_package.py."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "scripts"
    / "smoke_test_published_package.py"
)
spec = importlib.util.spec_from_file_location(
    "smoke_test_published_package", SCRIPT_PATH
)
assert spec is not None
assert spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_package_metadata_derives_imports_and_scripts_from_pyproject() -> None:
    """Smoke metadata should come from the package config by default."""
    config = {
        "project": {
            "name": "my-package",
            "scripts": {"my-cli": "my_package.cli:main"},
        },
        "tool": {
            "hatch": {
                "build": {
                    "targets": {
                        "wheel": {
                            "packages": ["src/my_package"],
                        },
                    },
                },
            },
        },
    }

    metadata = module.package_metadata(config)

    assert metadata.distribution_name == "my-package"
    assert metadata.import_names == ["my_package"]
    assert metadata.console_scripts == ["my-cli"]


def test_run_command_captures_output(monkeypatch) -> None:
    """Commands should capture output instead of piping live output to pagers."""
    run_kwargs = {}

    def fake_run(cmd, **kwargs):
        run_kwargs.update(kwargs)
        return subprocess.CompletedProcess(cmd, 0, "line 1\nline 2\n", "")

    monkeypatch.setattr(module.subprocess, "run", fake_run)

    result = module.run_command(["producer"], echo_output=False)

    assert result.stdout == "line 1\nline 2\n"
    assert run_kwargs["capture_output"] is True
    assert run_kwargs["text"] is True
    assert run_kwargs["check"] is False


def test_install_published_package_retries_until_indexed(monkeypatch) -> None:
    """Install should retry while a freshly published version propagates."""
    commands = []
    sleeps = []

    def fake_run_command(cmd, **kwargs):
        commands.append(cmd)
        assert kwargs["check"] is False
        return subprocess.CompletedProcess(cmd, 0 if len(commands) == 2 else 1, "", "")

    monkeypatch.setattr(module, "run_command", fake_run_command)
    monkeypatch.setattr(module.time, "sleep", sleeps.append)

    module.install_published_package(
        Path("/venv/bin/python"),
        "my-package",
        "1.2.3",
        attempts=2,
        delay_seconds=0.5,
        index_url="https://example.test/simple",
    )

    assert len(commands) == 2
    assert "my-package==1.2.3" in commands[0]
    assert commands[0][-2:] == ["--index-url", "https://example.test/simple"]
    assert sleeps == [0.5]


def test_console_script_preview_uses_captured_output(
    monkeypatch,
    capsys,
    tmp_path,
) -> None:
    """Console output previews should be taken from captured strings."""
    commands = []
    output = "\n".join(f"line {index}" for index in range(6))

    def fake_run_command(cmd, **kwargs):
        commands.append(cmd)
        assert kwargs["check"] is False
        assert kwargs["echo_output"] is False
        return subprocess.CompletedProcess(cmd, 0, output, "")

    monkeypatch.setattr(module, "run_command", fake_run_command)

    module.verify_console_scripts(
        tmp_path / "venv",
        ["my-cli"],
        ("--list",),
        preview_lines=3,
    )

    captured = capsys.readouterr()

    assert commands == [[str(tmp_path / "venv" / "bin" / "my-cli"), "--list"]]
    assert "|" not in " ".join(commands[0])
    assert "head" not in commands[0]
    assert "line 0" in captured.out
    assert "line 2" in captured.out
    assert "line 3" not in captured.out
    assert "... (3 more lines)" in captured.out
