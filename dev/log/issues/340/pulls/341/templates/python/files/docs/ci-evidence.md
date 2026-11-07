# CI evidence and security gates

All artifact transfers use the local JavaScript action in
`.github/actions/artifact`. It bundles exact versions of GitHub's artifact SDK,
Core and minimatch with a committed lockfile and third-party license notices.
Runtime credentials stay inside the runner's JavaScript action context.

Upload paths keep the `@actions/glob` rules: one pattern per line, `#`
comments, `!` exclusions, every file under a matched directory, and no hidden
entries or symbolic links. The action matches them with minimatch 11 itself,
because `@actions/glob` 0.7.0 requires the API that minimatch 11 removed and
older minimatch versions carry GHSA-g3hv-75wg-m249.

Transfers retry transient DNS/socket failures and HTTP 429/5xx responses up to
three times, with 5 and 10 second delays. Permanent refusals, quota errors and
missing evidence fail. Give every producer a unique artifact name: the action
refuses preexisting artifacts. If an upload's final response is lost, it deletes
only its own name before retrying; it never accepts old evidence as success.
Pages uploads use the standard `artifact.tar` layout and one-day retention.

Downloads retain SDK SHA256 verification and fail on mismatches or missing
digests. Until the upstream Buffer deprecation is fixed, `skipDecompress` avoids
unzip-stream. Python's standard `zipfile` module validates every member before
writing: traversal, symlinks, special files and conflicting destinations fail.
The action supports named downloads, star name patterns and `merge-multiple`.
Python 3 and GNU tar are supplied by the pinned Ubuntu runners.

After editing the action, regenerate and commit its bundle:

```sh
npm ci --prefix .github/actions/artifact --ignore-scripts
npm test --prefix .github/actions/artifact
npm run build --prefix .github/actions/artifact
git add -f .github/actions/artifact/dist
```

The Security workflow audits every committed `package-lock.json` with
`scripts/audit-npm-locks.sh` (`npm audit --package-lock-only
--audit-level=moderate`) on pushes, pull requests and its weekly schedule.
Dependabot (`.github/dependabot.yml`) proposes weekly npm and GitHub Actions
updates after a seven-day cooldown. Dependabot does not rebuild `dist`, so an npm
update pull request fails "Verify committed action bundle" until someone runs the
commands above on its branch and pushes the rebuilt bundle.

The Workflows pipeline tests injected transport errors and a real artifact
round trip, compares every downloaded byte, verifies the Pages tar, and runs
downloads with `NODE_OPTIONS=--throw-deprecation`. It also checks the bundle is
reproducible from the committed source and lockfile.

CodeQL uses full analysis for both Python and Actions. The job-level
`CODEQL_ACTION_DIFF_INFORMED_QUERIES='false'` setting avoids the compare API's
300-file truncation without changing query selection. The official analyzer
still uploads to Code Scanning, then `scripts/check_codeql_results.py` checks
every local SARIF report/run and fails on every finding regardless of severity,
invalid reports, or failed invocations. Every invocation's execution and
configuration notifications are checked even when execution succeeds and the
findings list is empty. Errors, warnings (including the SARIF default when level
is omitted), unknown levels, malformed records and malformed arrays fail the
gate, with descriptor, location and message context. Valid note/none
notifications remain informational. Reports are uploaded even when the gate
fails. The aggregate Security status therefore observes these failures directly.

The link checker accepts actual live-link recovery, but archive snapshots are
repair suggestions. A failed checker cannot pass without usable report evidence.
The archive helper fails closed when its report is missing or unusable.

Manual releases carry `VALIDATED_SHA` from the workflow event through versioning
and push recovery. The release helper accepts that commit or a direct child
whose full repository tree differs only in release metadata: `project.version`,
the matching local package version in `uv.lock`, `CHANGELOG.md`, and deletion of
collected `changelog.d/*.md` fragments (excluding README). All other manifest,
lock, source and file-mode changes require CI on the new revision. A verified
remote release child is adopted into a clean checkout before building; matching
version strings alone never establish recovery. Existing uv locks are refreshed
with `uv lock --offline`, and dependency drift fails attestation.

Explicit `fatal error in commit_refs_rules` and HTTP 429/5xx push failures retry
the unchanged commit at most three times, waiting 1 and 2 seconds. GH006/GH013
repository policy failures remain permanent, even when mixed with transient
text. Every failed push response is retained in the log; `RELEASE_DEBUG=1` adds
attempt/classification details. Lost races validate the remote before recovery
and attest the resulting commit before any subsequent push. No force push or
repository rule bypass is used.
