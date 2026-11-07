### Fixed

- Deploy GitHub Pages with the local `.github/actions/deploy-pages` action
  instead of `actions/deploy-pages@v5`. It retries a transient HTTP 5xx, 429 or
  lost connection from creating the deployment up to three times. Before each
  retry it adopts the commit's existing deployment unless that one failed. It
  fails at once on other 4xx refusals, reporting the status and request ID, and
  publishes exactly the artifact ID the build job outputs. The `DEP0040`
  `NODE_OPTIONS` workaround is no longer needed (#130).
- Run the link checker weekly and scope its cache key to the UTC day, so lychee
  never restores a cache it discards with `[WARN] Cache is too old` (#131).

### Security

- Patch glob (GHSA-3g3m-2fjr-6pw4) and minimatch (GHSA-g3hv-75wg-m249) in the
  artifact action's lockfile and bundle. The action now matches upload paths
  with minimatch 11, keeping the `@actions/glob` rules (#132).
- Audit every committed `package-lock.json` at `--audit-level=moderate` in the
  Security workflow, and add Dependabot for npm and GitHub Actions with a
  seven-day cooldown. A stale action bundle now fails with the rebuild
  commands (#132).
