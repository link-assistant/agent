# Case Study: Issue #33 — setup-npm.mjs: npm upgrade fails on GitHub Actions with Node.js 22.22.2

**Issue:** [#33](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/33)
**Related PR:** [#35](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/35)
**Reference implementation:** [link-assistant/web-capture#55](https://github.com/link-assistant/web-capture/pull/55)

## Problem Statement

The `setup-npm.mjs` script fails to upgrade npm on GitHub Actions runners when the runner image ships Node.js 22.22.2 with a broken npm 10.9.7. The bundled npm is missing the `promise-retry` module, causing all `npm install -g` commands to fail with `MODULE_NOT_FOUND`. This blocks `npm publish --provenance` (OIDC trusted publishing) which requires npm >= 11.5.1.

## Timeline

1. **2026-03-29** — GitHub Actions runner image `ubuntu-24.04` version `20260329.72.1` ships with Node.js 22.22.2 containing broken npm 10.9.7 ([actions/runner-images#13883](https://github.com/actions/runner-images/issues/13883)).
2. **2026-03-29** — Node.js issue filed: [nodejs/node#62425](https://github.com/nodejs/node/issues/62425) (regression report).
3. **2026-03-30** — Duplicate issue: [nodejs/node#62430](https://github.com/nodejs/node/issues/62430).
4. **2026-03-31** — npm CLI issue filed: [npm/cli#9151](https://github.com/npm/cli/issues/9151).
5. **2026-04-01** — Heroku buildpack affected: [heroku/heroku-buildpack-nodejs#1590](https://github.com/heroku/heroku-buildpack-nodejs/issues/1590).
6. **2026-04-14 09:22** — CI run [24391258731](https://github.com/link-assistant/web-capture/actions/runs/24391258731) on `link-assistant/web-capture` fails: all npm upgrade strategies fail with MODULE_NOT_FOUND.
7. **2026-04-14 10:57** — CI run [24395209194](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/24395209194) on this template repo: Release job fails (unrelated E404 on `my-package` publish, but setup-npm.mjs succeeded because Node 20.x was used).
8. **2026-04-14 11:40** — Issue #33 filed requesting upgrade to Node.js 24.x and case study analysis.

## Root Cause Analysis

### Root Cause: Missing `promise-retry` in Node.js 22.22.2 bundled npm

**What:** Node.js v22.22.2 ships npm 10.9.7 with an incomplete dependency tree. The `promise-retry` module (required by `@npmcli/arborist`) is missing from `node_modules/npm/node_modules/promise-retry/`.

**Why:** During the Node.js 22.22.2 release build, npm's dependency deduplication (hoisting) failed to include `promise-retry` in the bundled npm tree. The module should be at `/opt/hostedtoolcache/node/22.22.2/x64/lib/node_modules/npm/node_modules/promise-retry/` but is absent.

**Impact:** Any npm command that triggers `@npmcli/arborist` (the dependency resolver) crashes immediately:

```
npm error code MODULE_NOT_FOUND
npm error Cannot find module 'promise-retry'
npm error Require stack:
npm error - /opt/hostedtoolcache/node/22.22.2/x64/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/rebuild.js
```

**Affected platforms:**

- GitHub Actions `ubuntu-24.04` (image >= 20260329.72.1)
- Docker `node:22`, `node:22-slim`
- nvm-installed Node.js 22.22.2 on macOS/Linux
- Heroku Node.js buildpack

**Not affected:**

- Node.js 20.x (uses npm 10.8.x with complete dependency tree)
- Node.js 24.x (uses npm 11.x which replaced `promise-retry` with `@gar/promise-retry`)

## Solutions Applied

### 1. Upgrade Node.js from 20.x to 24.x in CI/CD workflows

Node.js 24.x (Active LTS, EOL April 2028) ships with npm 11.x which:

- Does not have the `promise-retry` bug (uses `@gar/promise-retry` instead)
- Already satisfies the npm >= 11.5.1 requirement for OIDC trusted publishing
- Reduces the need for npm upgrade in most cases

Changed all `node-version: '20.x'` references to `node-version: '24.x'` in `release.yml` (6 locations).

### 2. Add curl-based tarball fallback to setup-npm.mjs

Added a 4-strategy fallback chain to `setup-npm.mjs`:

1. **Standard:** `npm install -g npm@11` (works when npm is healthy)
2. **Curl tarball:** Download npm tarball directly via `curl`, bypassing broken npm entirely
3. **npx:** `npx --yes npm@11 install -g npm@11` (uses npx cache, bypasses arborist)
4. **Corepack:** `corepack enable && corepack prepare npm@11 --activate`

The curl-based fallback (strategy 2) is the most reliable workaround because it completely bypasses the broken npm binary. This is the same approach used in the [web-capture#55](https://github.com/link-assistant/web-capture/pull/55) fix.

### 3. Update GitHub Actions to latest versions

Updated all actions to their latest major versions:

- `actions/checkout`: v4 → v6
- `actions/setup-node`: v4 → v6
- `peter-evans/create-pull-request`: v7 → v8

### 4. Exit with error code 1 on failure

The updated `setup-npm.mjs` now calls `process.exit(1)` when all strategies fail, instead of silently continuing with a broken npm.

## Upstream Issues

| Repository                     | Issue                                                                  | Status | Description                                   |
| ------------------------------ | ---------------------------------------------------------------------- | ------ | --------------------------------------------- |
| actions/runner-images          | [#13883](https://github.com/actions/runner-images/issues/13883)        | Open   | Broken npm in Node.js 22.22.2 toolcache       |
| nodejs/node                    | [#62425](https://github.com/nodejs/node/issues/62425)                  | Open   | Regression report for Node.js 22.22.2         |
| nodejs/node                    | [#62430](https://github.com/nodejs/node/issues/62430)                  | Open   | Duplicate: npm -g fails with MODULE_NOT_FOUND |
| npm/cli                        | [#9151](https://github.com/npm/cli/issues/9151)                        | Open   | npm fails to install in latest Node 22        |
| heroku/heroku-buildpack-nodejs | [#1590](https://github.com/heroku/heroku-buildpack-nodejs/issues/1590) | Open   | npm 11.x bootstrap fails on Node 22.22.2      |

## Community Workarounds

From [npm/cli#9151](https://github.com/npm/cli/issues/9151):

- **Incremental upgrade:** `npm install -g npm@11.11.0` then `npm install -g npm@11.12.0`
- **Fallback chain:** `npm install -g npm@11 || npm install -g npm@10 && npm install -g npm@11`
- **Pin Node version:** Use `node-version: '22.22.1'` in `actions/setup-node`
- **Switch to Node 24.x:** Node 24.x ships with npm 11.x and is not affected

## Data Files

- `ci-logs/release-24395209194.log` — CI log from this repo's failed Release job (2026-04-14)
- `ci-logs/upstream-runner-images-13883.json` — GitHub Actions runner-images issue data
- `ci-logs/upstream-nodejs-62430.json` — Node.js issue data
- `ci-logs/upstream-npm-cli-9151.json` — npm CLI issue data

## References

- [actions/runner-images#13883](https://github.com/actions/runner-images/issues/13883) — npm in Node.js 22.22.2 toolcache has broken module tree
- [nodejs/node#62425](https://github.com/nodejs/node/issues/62425) — Possible NodeJS 22.22.2 regression
- [nodejs/node#62430](https://github.com/nodejs/node/issues/62430) — npm i -g npm@latest fails
- [npm/cli#9151](https://github.com/npm/cli/issues/9151) — npm fails to install in latest Node 22
- [link-assistant/web-capture#55](https://github.com/link-assistant/web-capture/pull/55) — Reference implementation with curl fallback
