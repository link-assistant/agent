#!/usr/bin/env python3
"""Fail CI on CodeQL findings as well as incomplete/invalid SARIF evidence."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def valid_reference(reference: object) -> bool:
    """Validate a SARIF descriptor reference without requiring optional IDs."""
    if not isinstance(reference, dict) or not any(
        key in reference for key in ("id", "index", "guid")
    ):
        return False
    for key in ("id", "guid"):
        if key in reference and (
            not isinstance(reference[key], str) or not reference[key]
        ):
            return False
    if "index" in reference and (
        type(reference["index"]) is not int or reference["index"] < 0
    ):
        return False
    return "toolComponent" not in reference or isinstance(
        reference["toolComponent"], dict
    )


def valid_notification(notification: object) -> bool:
    """Validate diagnostic records even when their severity is informational."""
    if not isinstance(notification, dict):
        return False
    message = notification.get("message")
    if not isinstance(message, dict) or not any(
        isinstance(message.get(key), str) for key in ("text", "markdown", "id")
    ):
        return False
    if any(
        key in message and not isinstance(message[key], str)
        for key in ("text", "markdown", "id")
    ):
        return False
    if "arguments" in message and (
        not isinstance(message["arguments"], list)
        or any(not isinstance(item, str) for item in message["arguments"])
    ):
        return False
    for key in ("descriptor", "associatedRule"):
        if key in notification and not valid_reference(notification[key]):
            return False
    locations = notification.get("locations", [])
    if not isinstance(locations, list):
        return False
    for location in locations:
        if not isinstance(location, dict):
            return False
        physical = location.get("physicalLocation", {})
        if not isinstance(physical, dict):
            return False
        for key in ("artifactLocation", "region", "contextRegion"):
            if key in physical and not isinstance(physical[key], dict):
                return False
        artifact = physical.get("artifactLocation", {})
        if "uri" in artifact and not isinstance(artifact["uri"], str):
            return False
        for key in ("region", "contextRegion"):
            region = physical.get(key, {})
            for coordinate in ("startLine", "startColumn", "endLine", "endColumn"):
                if coordinate in region and (
                    type(region[coordinate]) is not int or region[coordinate] < 1
                ):
                    return False
    return True


def validate_notifications(invocation: dict, prefix: str) -> list[str]:
    """An invocation can succeed while extraction/configuration is incomplete."""
    errors = []
    for key in ("toolExecutionNotifications", "toolConfigurationNotifications"):
        notifications = invocation.get(key, [])
        if not isinstance(notifications, list):
            errors.append(f"{prefix}: malformed {key} array")
            continue
        for index, notification in enumerate(notifications):
            valid = valid_notification(notification)
            level = notification.get("level", "warning") if valid else None
            if not valid or level not in ("note", "none"):
                # Include every descriptor/location/message, JSON escaped so
                # untrusted newlines cannot become workflow commands.
                errors.append(
                    f"{prefix}: {key}[{index}]: warning/error or malformed "
                    f"notification: {json.dumps(notification)}"
                )
    return errors


def validate_report(payload: object) -> list[str]:
    """Check every run without filtering by severity or suppressing results."""
    if not isinstance(payload, dict) or payload.get("version") != "2.1.0":
        return ["Expected a SARIF 2.1.0 object"]
    runs = payload.get("runs")
    if not isinstance(runs, list) or not runs:
        return ["Missing or invalid SARIF runs"]
    errors = []
    for index, run in enumerate(runs):
        prefix = f"run {index + 1}"
        if not isinstance(run, dict):
            errors.append(f"{prefix}: invalid run")
            continue
        tool = run.get("tool")
        driver = tool.get("driver") if isinstance(tool, dict) else None
        name = driver.get("name") if isinstance(driver, dict) else None
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{prefix}: missing tool driver")
        invocations = run.get("invocations", [])
        if not isinstance(invocations, list) or any(
            not isinstance(invocation, dict)
            or invocation.get("executionSuccessful") is not True
            for invocation in invocations
        ):
            errors.append(f"{prefix}: unsuccessful or invalid tool invocation")
        if isinstance(invocations, list):
            for invocation_index, invocation in enumerate(invocations):
                if isinstance(invocation, dict):
                    errors.extend(
                        validate_notifications(
                            invocation, f"{prefix}, invocation {invocation_index + 1}"
                        )
                    )
        results = run.get("results")
        if not isinstance(results, list):
            errors.append(f"{prefix}: missing or invalid results")
            continue
        for finding in results:
            rule = (
                finding.get("ruleId", "unknown rule")
                if isinstance(finding, dict)
                else "invalid result"
            )
            errors.append(f"{prefix}: CodeQL finding: {json.dumps(rule)}")
    return errors


def main(directory: Path) -> int:
    """Validate all reports, failing closed when evidence is unavailable."""
    reports = sorted(directory.rglob("*.sarif")) if directory.is_dir() else []
    if not reports:
        print(f"No CodeQL SARIF reports found in {directory}", file=sys.stderr)
        return 1
    failures = 0
    for report in reports:
        try:
            errors = validate_report(json.loads(report.read_text(encoding="utf-8")))
        except (OSError, ValueError, UnicodeError) as error:
            errors = [f"Cannot read SARIF: {error}"]
        for error in errors:
            # Plain diagnostics keep repository-controlled rule IDs inert.
            print(f"{report}: {error}")
        failures += len(errors)
    print(f"Checked {len(reports)} CodeQL report(s): {failures} finding(s)/error(s).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) == 2 else Path("codeql-results")))
