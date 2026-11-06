#!/usr/bin/env python3
"""
Version packages and commit to main branch.

This script handles version bumping and committing for CI/CD workflows.
It supports idempotent re-runs and detects when work was already completed.

Usage:
    python scripts/version_and_commit.py --bump-type <major|minor|patch> [--description "..."]

Example:
    python scripts/version_and_commit.py --bump-type patch
    python scripts/version_and_commit.py --bump-type minor --description "New feature"

Environment variables:
    GITHUB_OUTPUT: Path to GitHub Actions output file
    VALIDATED_SHA: Immutable commit validated by CI (defaults to starting HEAD locally)
    RELEASE_DEBUG: Set to 1 for push attempt/classification diagnostics
"""

import argparse
import os
import re
import subprocess
import sys
import time
import tomllib
from enum import Enum, auto
from pathlib import Path


def run_command(
    cmd: list[str], check: bool = True, capture: bool = False
) -> subprocess.CompletedProcess:
    """Run a command and handle errors."""
    cmd_str = " ".join(cmd)
    print(f"Running: {cmd_str}")

    result = subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        check=False,
    )

    if not capture:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)

    if check and result.returncode != 0:
        if capture:
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
        print(
            f"Error: Command failed with exit code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(result.returncode)

    return result


def set_github_output(key: str, value: str) -> None:
    """Set GitHub Actions output variable."""
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a") as f:
            f.write(f"{key}={value}\n")
        print(f"Set output: {key}={value}")


def parse_version(content: str) -> str:
    """Read project.version from pyproject.toml content (issue #67).

    A line-anchored regex cannot see TOML tables, so a ``version`` key in any
    other table -- scriv's documented ``[tool.scriv] version``, for example --
    matched first and released under the wrong number. Parse the document and
    read the field by its table path instead; a missing version fails loudly.
    """
    try:
        document = tomllib.loads(content)
    except tomllib.TOMLDecodeError as error:
        raise ValueError(f"pyproject.toml is not valid TOML: {error}") from error
    if "project" not in document or not isinstance(document["project"], dict):
        raise ValueError("pyproject.toml has no [project] table")
    version = document["project"].get("version")
    if not isinstance(version, str):
        raise ValueError("pyproject.toml has no project.version string")
    return version


def get_current_version(pyproject_path: Path) -> str:
    """Get version from pyproject.toml."""
    return parse_version(pyproject_path.read_text())


def get_repo_root() -> Path:
    """Return the current git repository root."""
    output = run_command(
        ["git", "rev-parse", "--show-toplevel"],
        capture=True,
    ).stdout.strip()
    return Path(output)


# Not every failed `git push` is a lost race (issue #73). A repository
# ruleset rejection arrives shaped like a non-fast-forward, and rebasing
# against a policy refusal three times burns the job's budget before dying
# with a misleading "conflict" error, so the failure is classified first.
REPOSITORY_RULE_PATTERNS = (
    "gh006",
    "gh013",
    "repository rule violations",
    "changes must be made through a pull request",
    "protected branch",
    "push declined",
)

NON_FAST_FORWARD_PATTERNS = (
    "[rejected]",
    "non-fast-forward",
    "fetch first",
    "updates were rejected",
)


class PushFailure(Enum):
    """Classification of a failed `git push`."""

    REPOSITORY_RULES = auto()
    LOST_RACE = auto()
    TRANSIENT = auto()
    OTHER = auto()


def classify_push_failure(raw_output: str) -> PushFailure:
    """Separate permanent policy failures, transient server failures and races."""
    haystack = raw_output.lower()
    # Rules first: a ruleset rejection also contains the word "rejected".
    if any(pattern in haystack for pattern in REPOSITORY_RULE_PATTERNS):
        return PushFailure.REPOSITORY_RULES
    if "fatal error in commit_refs_rules" in haystack or re.search(
        r"\b(?:http(?:/\d(?:\.\d)?)?\s+|returned error:\s*)(?:429|5\d\d)\b",
        haystack,
    ):
        return PushFailure.TRANSIENT
    if any(pattern in haystack for pattern in NON_FAST_FORWARD_PATTERNS):
        return PushFailure.LOST_RACE
    return PushFailure.OTHER


def run_git_capturing(cmd: list[str]) -> subprocess.CompletedProcess:
    """Run a git command, returning its result without exiting on failure."""
    print(f"Running: {' '.join(cmd)}")
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def push_branch_with_rebase_retry(
    branch: str,
    *,
    max_attempts: int = 3,
    validated_sha: str | None = None,
    pyproject_git_path: str = "pyproject.toml",
) -> None:
    """Push to a branch, retrying a lost race with a rebase (issue #73).

    Transient server failures retry the unchanged commit with backoff. Policy
    errors remain permanent. Remote recovery and rebases must retain the
    validated source and dependency tree. Local callers default to starting HEAD.
    """
    if not 1 <= max_attempts <= 3:
        raise ValueError("Push attempts must be between 1 and 3")
    validated_sha = validated_sha or git_text(
        ["rev-parse", os.environ.get("VALIDATED_SHA", "HEAD")]
    )
    retry_head = git_text(["rev-parse", "HEAD"])
    for attempt in range(1, max_attempts + 1):
        assert_clean_checkout()
        if git_text(["rev-parse", "HEAD"]) != retry_head:
            raise ValueError("Release commit changed during push retry")
        attest_release(validated_sha, "HEAD", pyproject_git_path)
        completed = run_git_capturing(
            ["git", "push", "origin", f"HEAD:refs/heads/{branch}"]
        )
        if completed.returncode == 0:
            return

        push_error = f"{completed.stdout}{completed.stderr}".strip()
        failure = classify_push_failure(push_error)
        print(push_error, file=sys.stderr)
        if os.environ.get("RELEASE_DEBUG") == "1":
            print(
                f"Release push attempt {attempt}/{max_attempts}: {failure.name}",
                file=sys.stderr,
            )

        if failure is PushFailure.REPOSITORY_RULES:
            print(
                f"::error title=Push declined by repository rules::The push to "
                f"branch '{branch}' was declined by a repository rule (a "
                f"GH006/GH013-class rejection, e.g. 'changes must be made through "
                f"a pull request' or a protected-branch ruleset). Rebasing and "
                f"retrying cannot change repository policy: release this change "
                f"through a pull request, or adjust the ruleset so the release "
                f"bot may push.\n--- git output ---\n{push_error}",
                file=sys.stderr,
            )
            sys.exit(1)

        if failure is PushFailure.OTHER:
            print(f"Error pushing: {push_error}", file=sys.stderr)
            sys.exit(1)

        if attempt >= max_attempts:
            print(
                f"Error pushing after {max_attempts} attempts: {push_error}",
                file=sys.stderr,
            )
            sys.exit(1)

        if failure is PushFailure.TRANSIENT:
            time.sleep(2 ** (attempt - 1))
            continue

        run_command(["git", "fetch", "origin", branch])
        remote = f"origin/{branch}"
        attest_release(validated_sha, remote, pyproject_git_path)
        if git_text(["rev-parse", remote]) != validated_sha:
            # A lost response may have published an equivalent release.
            local_version = parse_version(
                git_text(["show", f"HEAD:{pyproject_git_path}"])
            )
            remote_version = parse_version(
                git_text(["show", f"{remote}:{pyproject_git_path}"])
            )
            if local_version != remote_version:
                raise ValueError(
                    "Remote release version differs; rerun CI on the new revision"
                )
            run_command(["git", "reset", "--hard", remote])
            return
        print(
            f"Push rejected as non-fast-forward (attempt {attempt}/"
            f"{max_attempts}); the remote branch moved. Rebasing and retrying...",
            file=sys.stderr,
        )
        rebase = run_git_capturing(["git", "pull", "--rebase", "origin", branch])
        if rebase.returncode != 0:
            rebase_error = f"{rebase.stdout}{rebase.stderr}".strip()
            print(f"Error during pull --rebase: {rebase_error}", file=sys.stderr)
            run_git_capturing(["git", "rebase", "--abort"])
            sys.exit(1)
        attest_release(validated_sha, "HEAD", pyproject_git_path)
        retry_head = git_text(["rev-parse", "HEAD"])


def configure_git() -> None:
    """Configure git for automated commits."""
    print("Configuring git...")
    run_command(
        ["git", "config", "user.name", "github-actions[bot]"],
    )
    run_command(
        ["git", "config", "user.email", "github-actions[bot]@users.noreply.github.com"],
    )


def git_text(args: list[str]) -> str:
    """Read Git evidence, failing closed on missing objects or failed commands."""
    return run_command(["git", *args], capture=True).stdout.strip()


def assert_clean_checkout() -> None:
    """Never reset or publish an uncommitted source/dependency change."""
    if git_text(["status", "--porcelain", "--untracked-files=all"]):
        raise ValueError("Release checkout is dirty; rerun CI on committed source")


def release_tree(ref: str) -> dict[str, tuple[str, str]]:
    """Inventory every tracked path, including its mode and blob/submodule SHA."""
    entries = git_text(["ls-tree", "--full-tree", "-rz", ref]).split("\0")
    tree = {}
    for entry in entries:
        if entry:
            metadata, path = entry.split("\t", 1)
            mode, _, oid = metadata.split()
            tree[path] = (mode, oid)
    return tree


def normalized_manifest(ref: str, path: str) -> tuple[dict, str]:
    """Ignore only project.version, never dependencies or other version keys."""
    content = git_text(["show", f"{ref}:{path}"])
    version = parse_version(content)
    document = tomllib.loads(content)
    del document["project"]["version"]
    return document, version


def normalized_lock(ref: str, path: str, manifest: dict, version: str) -> dict:
    """Normalize only this project's uv package version, preserving resolution."""
    document = tomllib.loads(git_text(["show", f"{ref}:{path}"]))
    packages = document.get("package")
    if not isinstance(packages, list):
        raise ValueError("Invalid uv.lock package array")
    own_packages = []
    for package in packages:
        if not isinstance(package, dict):
            raise ValueError("Invalid uv.lock package")
        project_name = re.sub(
            r"[-_.]+", "-", manifest["project"].get("name", "")
        ).lower()
        if package.get("name") == project_name and package.get("source") in (
            {"editable": "."},
            {"virtual": "."},
        ):
            own_packages.append(package)
    if len(own_packages) != 1 or own_packages[0].get("version") != version:
        raise ValueError(
            "uv.lock must contain exactly one matching local project version"
        )
    del own_packages[0]["version"]
    return document


def attest_release(validated_sha: str, candidate: str, manifest_path: str) -> None:
    """Allow the validated commit or its sole metadata-only release child.

    This is a full repository comparison, also for a package under python/.
    A missing/replaced validated parent, merge, dependency drift, file-mode
    change, or unrelated path fails closed and requires CI on the new revision.
    """
    validated = git_text(["rev-parse", "--verify", f"{validated_sha}^{{commit}}"])
    head = git_text(["rev-parse", "--verify", f"{candidate}^{{commit}}"])
    if head == validated:
        return
    parents = git_text(["show", "-s", "--format=%P", head]).split()
    if parents != [validated]:
        raise ValueError(
            "Release must retain the original validated commit as its sole parent; rerun CI"
        )
    before, after = release_tree(validated), release_tree(head)
    root = Path(manifest_path).parent
    lock_path = (root / "uv.lock").as_posix()
    changelog_path = (root / "CHANGELOG.md").as_posix()
    fragment_dir = (root / "changelog.d").as_posix()
    old_manifest, old_version = normalized_manifest(validated, manifest_path)
    new_manifest, new_version = normalized_manifest(head, manifest_path)
    if old_manifest != new_manifest:
        raise ValueError("Release manifest source/dependency drift; rerun CI")
    if lock_path in before or lock_path in after:
        if (
            lock_path not in before
            or lock_path not in after
            or normalized_lock(validated, lock_path, old_manifest, old_version)
            != normalized_lock(head, lock_path, new_manifest, new_version)
        ):
            raise ValueError("Release locked dependency drift; rerun CI")
    for path in before.keys() | after.keys():
        if before.get(path) == after.get(path):
            continue
        if path in (manifest_path, lock_path, changelog_path):
            if (
                path not in after
                or after[path][0] != "100644"
                or (path in before and before[path][0] != after[path][0])
            ):
                raise ValueError(f"Invalid release metadata mode/deletion: {path}")
            continue
        fragment = Path(path)
        if (
            fragment.parent.as_posix() == fragment_dir
            and fragment.suffix == ".md"
            and fragment.name != "README.md"
            and path in before
            and path not in after
            and before[path][0] == "100644"
        ):
            continue
        raise ValueError(f"Release source/dependency drift at {path}; rerun CI")
    if old_version == new_version:
        raise ValueError("Release metadata child must change project.version; rerun CI")


def check_remote_changes(
    pyproject_path: Path,
    pyproject_git_path: str,
    validated_sha: str | None = None,
) -> tuple[bool, str]:
    """
    Check if remote main has advanced (handles re-runs).
    Returns (already_released, remote_version).
    """
    print("\nChecking for remote changes...")
    assert_clean_checkout()
    validated_sha = validated_sha or git_text(["rev-parse", "HEAD"])
    attest_release(validated_sha, "HEAD", pyproject_git_path)
    run_command(["git", "fetch", "origin", "main"])

    # Get commit SHAs
    local_head = run_command(
        ["git", "rev-parse", "HEAD"],
        capture=True,
    ).stdout.strip()

    remote_head = run_command(
        ["git", "rev-parse", "origin/main"],
        capture=True,
    ).stdout.strip()

    if local_head != remote_head:
        print(f"Remote main has advanced (local: {local_head}, remote: {remote_head})")
        print("This may indicate a previous attempt partially succeeded.")

        attest_release(validated_sha, remote_head, pyproject_git_path)
        if remote_head == validated_sha:
            # A prior attempt committed locally but did not publish its child.
            push_branch_with_rebase_retry(
                "main",
                validated_sha=validated_sha,
                pyproject_git_path=pyproject_git_path,
            )
            return True, get_current_version(pyproject_path)
        # Get remote version only after the complete source/lock attestation.
        remote_content = run_command(
            ["git", "show", f"origin/main:{pyproject_git_path}"],
            capture=True,
        ).stdout

        try:
            remote_version = parse_version(remote_content)
        except ValueError as error:
            print(f"Could not parse remote pyproject.toml: {error}")
            return False, ""

        print(f"Remote version: {remote_version}")

        print("Adopting attested metadata-only release commit")
        run_command(["git", "reset", "--hard", remote_head])
        return True, remote_version

    if remote_head != validated_sha:
        return True, get_current_version(pyproject_path)
    return False, ""


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Version bump and commit for CI/CD",
    )
    parser.add_argument(
        "--bump-type",
        choices=["major", "minor", "patch"],
        required=True,
        help="Type of version bump",
    )
    parser.add_argument(
        "--description",
        default="",
        help="Description for changelog",
    )

    args = parser.parse_args()

    # Determine project root
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    pyproject_path = project_root / "pyproject.toml"
    repo_root = get_repo_root()
    pyproject_git_path = pyproject_path.relative_to(repo_root).as_posix()

    if not pyproject_path.exists():
        print(f"Error: {pyproject_path} not found", file=sys.stderr)
        return 1

    try:
        validated_sha = git_text(
            [
                "rev-parse",
                "--verify",
                f"{os.environ.get('VALIDATED_SHA', 'HEAD')}^{{commit}}",
            ]
        )
        assert_clean_checkout()
        attest_release(validated_sha, "HEAD", pyproject_git_path)
        # Configure git
        configure_git()

        # Check for remote changes
        already_released, remote_version = check_remote_changes(
            pyproject_path,
            pyproject_git_path,
            validated_sha,
        )

        if already_released:
            print("Version bump already completed in previous run")
            set_github_output("version_committed", "false")
            set_github_output("already_released", "true")
            set_github_output("new_version", remote_version)
            return 0

        # Get current version
        old_version = get_current_version(pyproject_path)
        print(f"\nCurrent version: {old_version}")

        fragment_dir = project_root / "changelog.d"
        fragments = [
            path for path in fragment_dir.glob("*.md") if path.name != "README.md"
        ]

        # Run version bump
        print(f"\nBumping version ({args.bump_type})...")
        bump_cmd = [
            sys.executable,
            str(project_root / "scripts" / "bump_version.py"),
            args.bump_type,
        ]
        if args.description:
            bump_cmd.extend(["--description", args.description])
        if fragments:
            # Scriv writes the detailed entry. Avoid a second generic heading.
            bump_cmd.append("--skip-changelog")

        run_command(bump_cmd)

        # Get new version
        new_version = get_current_version(pyproject_path)
        print(f"New version: {new_version}")
        if (project_root / "uv.lock").exists():
            run_command(["uv", "lock", "--offline", "--project", str(project_root)])

        if fragments:
            print(f"Collecting {len(fragments)} changelog fragment(s)...")
            run_command(["scriv", "collect", "--version", new_version])
        else:
            print("No changelog fragments found; keeping the generic release entry")
        set_github_output("new_version", new_version)

        # Check for changes
        status = run_command(
            ["git", "status", "--porcelain"],
            capture=True,
        ).stdout.strip()

        if status:
            print("\nChanges detected, committing...")

            # Stage all changes
            run_command(["git", "add", "-A"])

            # Commit with version as message
            run_command(["git", "commit", "-m", new_version])

            # Push to main; only a genuine lost race is retried (issue #73)
            push_branch_with_rebase_retry(
                "main",
                validated_sha=validated_sha,
                pyproject_git_path=pyproject_git_path,
            )

            print(
                f"\n✅ Version bump committed and pushed: {old_version} → {new_version}"
            )
            set_github_output("version_committed", "true")
        else:
            print("\nNo changes to commit")
            set_github_output("version_committed", "false")

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
