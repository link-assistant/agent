#!/usr/bin/env python3
"""Install and exercise a just-published Python package from an index."""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - workflow runs on Python 3.13.
    tomllib = None  # type: ignore[assignment]


DEFAULT_INSTALL_ATTEMPTS = 6
DEFAULT_INSTALL_DELAY_SECONDS = 20.0
DEFAULT_PREVIEW_LINES = 20
DEFAULT_SCRIPT_ARGS = ("--help",)


class SmokeTestError(RuntimeError):
    """Raised when the published package smoke test fails."""


@dataclass(frozen=True)
class PackageMetadata:
    """Package metadata needed for the published install smoke test."""

    distribution_name: str
    import_names: list[str]
    console_scripts: list[str]


def format_command(cmd: list[str]) -> str:
    """Return a shell-like command string for logs."""
    return shlex.join(cmd)


def print_stream(output: str, stream: Any = sys.stdout) -> None:
    """Print subprocess output without adding an extra blank line."""
    if output:
        end = "" if output.endswith("\n") else "\n"
        print(output, end=end, file=stream)


def run_command(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    echo_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a command with captured output so previews never close live pipes."""
    print(f"Running: {format_command(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )

    if echo_output:
        print_stream(result.stdout)
        print_stream(result.stderr, sys.stderr)

    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(
            result.returncode,
            cmd,
            output=result.stdout,
            stderr=result.stderr,
        )

    return result


def load_pyproject(pyproject_path: Path) -> dict[str, Any]:
    """Load pyproject.toml with a structured TOML parser."""
    if tomllib is None:
        message = "smoke_test_published_package.py requires Python 3.11+"
        raise SmokeTestError(message)

    with pyproject_path.open("rb") as pyproject_file:
        return tomllib.load(pyproject_file)


def nested_mapping(mapping: dict[str, Any], *keys: str) -> dict[str, Any]:
    """Return a nested mapping from TOML data, or an empty mapping."""
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict):
            return {}
        current = current.get(key, {})
    if isinstance(current, dict):
        return current
    return {}


def import_names_from_wheel_packages(
    config: dict[str, Any],
    distribution_name: str,
) -> list[str]:
    """Derive import names from Hatch wheel package paths."""
    wheel_target = nested_mapping(config, "tool", "hatch", "build", "targets", "wheel")
    packages = wheel_target.get("packages", [])
    import_names: list[str] = []

    if isinstance(packages, list):
        for package_path in packages:
            if not isinstance(package_path, str):
                continue
            import_name = Path(package_path.replace("\\", "/")).name
            if import_name and import_name not in import_names:
                import_names.append(import_name)

    if import_names:
        return import_names

    fallback_name = distribution_name.replace("-", "_").replace(".", "_")
    if fallback_name.isidentifier():
        return [fallback_name]

    message = (
        "could not derive an import name from pyproject.toml; "
        "pass --import-name explicitly"
    )
    raise SmokeTestError(message)


def package_metadata(
    config: dict[str, Any],
    *,
    package_name_override: str | None = None,
    import_name_overrides: list[str] | None = None,
) -> PackageMetadata:
    """Extract package metadata from pyproject.toml and CLI overrides."""
    project = nested_mapping(config, "project")
    distribution_name = package_name_override or str(project.get("name", "")).strip()
    if not distribution_name:
        message = "could not determine package name from pyproject.toml"
        raise SmokeTestError(message)

    scripts = project.get("scripts", {})
    console_scripts = list(scripts) if isinstance(scripts, dict) else []
    import_names = import_name_overrides or import_names_from_wheel_packages(
        config,
        distribution_name,
    )

    return PackageMetadata(
        distribution_name=distribution_name,
        import_names=import_names,
        console_scripts=console_scripts,
    )


def venv_python(venv_dir: Path) -> Path:
    """Return the Python executable for a virtual environment."""
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def venv_script(venv_dir: Path, script_name: str) -> Path:
    """Return a console script path inside a virtual environment."""
    scripts_dir = venv_dir / ("Scripts" if os.name == "nt" else "bin")
    script_path = scripts_dir / script_name
    if os.name == "nt" and not script_path.exists():
        return script_path.with_suffix(".exe")
    return script_path


def create_virtualenv(venv_dir: Path) -> Path:
    """Create a clean virtual environment and return its Python executable."""
    run_command([sys.executable, "-m", "venv", str(venv_dir)])
    python = venv_python(venv_dir)
    run_command([str(python), "-m", "pip", "install", "--upgrade", "pip"])
    return python


def install_published_package(
    python: Path,
    package_name: str,
    version: str,
    *,
    attempts: int,
    delay_seconds: float,
    index_url: str | None,
) -> None:
    """Install a published package, retrying while the package index catches up."""
    if attempts < 1:
        message = "--install-attempts must be at least 1"
        raise SmokeTestError(message)

    package_spec = f"{package_name}=={version}"
    cmd = [
        str(python),
        "-m",
        "pip",
        "install",
        "--no-cache-dir",
        package_spec,
    ]
    if index_url:
        cmd.extend(["--index-url", index_url])

    for attempt in range(1, attempts + 1):
        print(f"Installing {package_spec} (attempt {attempt}/{attempts})")
        result = run_command(cmd, check=False)
        if result.returncode == 0:
            return
        if attempt < attempts:
            print(f"Install failed; retrying in {delay_seconds:g} seconds")
            time.sleep(delay_seconds)

    message = f"failed to install {package_spec} from the package index"
    raise SmokeTestError(message)


def verify_imports(python: Path, metadata: PackageMetadata, version: str) -> None:
    """Import installed modules and verify distribution metadata version."""
    for import_name in metadata.import_names:
        code = "\n".join(
            [
                "import importlib",
                "import importlib.metadata as metadata",
                f"module = importlib.import_module({import_name!r})",
                f"actual = metadata.version({metadata.distribution_name!r})",
                f"expected = {version!r}",
                "if actual != expected:",
                "    raise SystemExit(f'version mismatch: {actual} != {expected}')",
                "location = getattr(module, '__file__', '<unknown>')",
                "print(f'imported {module.__name__} from {location}')",
            ]
        )
        run_command([str(python), "-c", code])


def preview_output(output: str, max_lines: int = DEFAULT_PREVIEW_LINES) -> str:
    """Return a bounded preview from already-captured command output."""
    if max_lines < 1:
        return ""

    lines = output.splitlines()
    preview = "\n".join(lines[:max_lines])
    remaining = len(lines) - max_lines
    if remaining > 0:
        preview = f"{preview}\n... ({remaining} more lines)"
    return preview


def print_preview(label: str, output: str, max_lines: int) -> None:
    """Print a named preview of captured output."""
    preview = preview_output(output, max_lines)
    if preview:
        print(f"{label}:\n{preview}")


def verify_console_scripts(
    venv_dir: Path,
    script_names: list[str],
    script_args: tuple[str, ...],
    *,
    preview_lines: int,
) -> None:
    """Run installed console scripts with captured output previews."""
    if not script_names:
        print("No console scripts declared; skipping CLI smoke tests")
        return

    for script_name in script_names:
        cmd = [str(venv_script(venv_dir, script_name)), *script_args]
        result = run_command(cmd, check=False, echo_output=False)
        print_preview(f"{script_name} stdout preview", result.stdout, preview_lines)
        print_preview(f"{script_name} stderr preview", result.stderr, preview_lines)

        if result.returncode != 0:
            message = f"console script {script_name!r} failed smoke test"
            raise SmokeTestError(message)

        if not (result.stdout.strip() or result.stderr.strip()):
            message = f"console script {script_name!r} produced no output"
            raise SmokeTestError(message)


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser."""
    parser = argparse.ArgumentParser(
        description="Install and smoke-test a just-published package version",
    )
    parser.add_argument("--version", required=True, help="Published version to install")
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path.cwd(),
        help="Project root containing pyproject.toml",
    )
    parser.add_argument(
        "--package-name",
        help="Distribution name override; defaults to project.name",
    )
    parser.add_argument(
        "--import-name",
        action="append",
        dest="import_names",
        help="Import name to verify; may be repeated",
    )
    parser.add_argument(
        "--skip-console-scripts",
        action="store_true",
        help="Skip [project.scripts] smoke tests",
    )
    parser.add_argument(
        "--script-arg",
        action="append",
        dest="script_args",
        help="Argument passed to each console script; defaults to --help",
    )
    parser.add_argument(
        "--install-attempts",
        type=int,
        default=DEFAULT_INSTALL_ATTEMPTS,
        help="Number of pip install attempts while waiting for index propagation",
    )
    parser.add_argument(
        "--install-delay-seconds",
        type=float,
        default=DEFAULT_INSTALL_DELAY_SECONDS,
        help="Delay between package install attempts",
    )
    parser.add_argument(
        "--preview-lines",
        type=int,
        default=DEFAULT_PREVIEW_LINES,
        help="Maximum captured output lines to print for each console script",
    )
    parser.add_argument(
        "--index-url",
        default=None,
        help="Package index URL override; defaults to pip configuration",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the published package smoke test."""
    parser = build_parser()
    args = parser.parse_args(argv)

    project_root = args.project_root.resolve()
    pyproject_path = project_root / "pyproject.toml"
    script_args = tuple(args.script_args or DEFAULT_SCRIPT_ARGS)

    try:
        config = load_pyproject(pyproject_path)
        metadata = package_metadata(
            config,
            package_name_override=args.package_name,
            import_name_overrides=args.import_names,
        )

        print(
            "Smoke testing "
            f"{metadata.distribution_name}=={args.version} "
            f"with imports: {', '.join(metadata.import_names)}"
        )

        with tempfile.TemporaryDirectory(prefix="published-package-smoke-") as temp_dir:
            temp_path = Path(temp_dir)
            venv_dir = temp_path / "venv"
            python = create_virtualenv(venv_dir)
            install_published_package(
                python,
                metadata.distribution_name,
                args.version,
                attempts=args.install_attempts,
                delay_seconds=args.install_delay_seconds,
                index_url=args.index_url,
            )
            verify_imports(python, metadata, args.version)
            if not args.skip_console_scripts:
                verify_console_scripts(
                    venv_dir,
                    metadata.console_scripts,
                    script_args,
                    preview_lines=args.preview_lines,
                )

        print("Published package smoke test passed")
        return 0
    except (OSError, SmokeTestError, subprocess.CalledProcessError) as error:
        print(f"Published package smoke test failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
