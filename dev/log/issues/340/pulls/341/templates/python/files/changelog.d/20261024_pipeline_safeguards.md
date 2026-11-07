### Fixed

- Exempt Dependabot authors from changelog fragments and count shell/JSON
  changes when selecting CI checks.
- Queue pending release writers, wait for every required check, default manual
  releases to patch, and fail package builds that produce no artifacts.
- Diagnose missing PyPI trusted publishers and disabled dependency graphs with
  actionable instructions while preserving unknown results for transient errors.
- Check standalone shell scripts, show release-preflight verdicts, preserve full
  execution/grace budgets, and resolve fork PR heads correctly in status gates.
- Update checkout and Python setup actions, authenticate pedantic workflow audits,
  persist link caches/reports, avoid empty link inputs, and suppress only the
  known Pages dependency warning.
