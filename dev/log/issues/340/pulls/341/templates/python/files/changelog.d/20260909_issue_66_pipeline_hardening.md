### Fixed

- Scoped the Docker buildx GitHub Actions cache to the image being built, so
  concurrent builds no longer evict each other's layers (closes #66).
- Read `pyproject.toml` fields by TOML table path instead of line-anchored
  grep, so scriv's documented `[tool.scriv] version` can no longer shadow
  `project.version` during a release (closes #67).
- Audited the resolved dependency set instead of the environment used to run
  the audit, keeping `pip` itself out of scope, and streamed pip-audit output
  so an advisory table is printed rather than swallowed on failure
  (closes #68).
- Replaced the grey pipeline-status gate with a real terminal-status job:
  GitHub reports `timeout-minutes` kills as `cancelled`, so the gate now
  observes every job in every workflow and only forgives runs superseded by a
  newer commit (closes #69).
- Retried `git fetch` in the fresh-merge simulation before giving up, so a
  flaky network between checkout and merge simulation no longer fails an
  unrelated pull request (closes #70).
- Pinned the actionlint Docker image by digest to 1.7.12, which adds the
  `glob` check for never-matching `paths:` filters and the modern hosted
  runner labels; a mutable tag of a repository outside this organization is
  arbitrary code in a job that analyses credentials (closes #71).
- Added a `validate-docs` job that checks required documents and sections,
  enforces a larger file-size budget for markdown, and detects docs-only
  changes so the changelog gate can relax for them (closes #72).
- Classified push failures before the release rebase retry: repository-rule
  rejections exit immediately with an explanation, only a lost push race is
  retried with a bounded `pull --rebase`, and everything else fails with the
  captured error (closes #73).
- Re-checked the lychee failures where no host ever answered, outside lychee:
  `--max-retries` cannot retry a connection reset during connect
  (lycheeverse/lychee#2297), so a healthy URL behind a RST reddened the run
  without one retry. Failures carrying a status code stay final, and the
  Web Archive fallback and the fail step are gated on the re-check with the
  fail-safe `!= 'true'` form (closes #78).
- Named the zizmor version (1.29.0) instead of trusting the action's frozen
  `latest` table, and added a narrow pedantic pass
  (`--min-severity high --min-confidence high`) so the Pedantic-only audits
  that cover `uses: docker://` image references actually enforce the
  `'*': hash-pin` policy without the stylistic noise (closes #75, #76).

### Added

- Added a release-preflight job that proves the publishing credentials can
  write before any expensive job runs: PyPI trusted publishing is probed by
  minting a short-lived upload token from the workflow's OIDC token, Docker
  Hub by opening and immediately cancelling a blob-upload session. Every
  failure is reported (not just the first), unknown is never a pass, and
  pull requests run the same probes in advisory report mode (closes #74,
  #77).
