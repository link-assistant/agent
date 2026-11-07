# Issue 56 Case Study: Universal React App Builds

## Scope

Issue: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/56

Pull request: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/57

Issue 56 asked this template to support a universal React app example that can
run directly on GitHub Pages, be packaged for desktop with Electron, and be
prepared for Android/iOS builds with Capacitor. It also required collecting
research data in `docs/case-studies/issue-56` and using practices from
`konard/vk-bot-desktop` and `deep-foundation/sdk`.

## Requirements

| Requirement                                                                      | Resolution                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Use existing `src/index.js` code to provide a visual UI for `add` and `multiply` | Added `examples/universal-app`, a Vite React app that imports `add` and `multiply` from `../../../src/index.js`.                            |
| GitHub Pages should run the UI directly as an SPA                                | Added `.github/workflows/example-app.yml` with a Pages deployment path and a Vite base-path switch for repository Pages.                    |
| GitHub Pages should also point users to desktop downloads                        | The example UI includes desktop target information and links to the repository's latest GitHub release for downloadable Electron artifacts. |
| Support desktop app building                                                     | Added Electron Forge configuration and root scripts for local packaging and distributable creation.                                         |
| Support iOS and Android example builds                                           | Added Capacitor config and mobile scripts for adding, syncing, running, and building Android/iOS projects.                                  |
| Explain how to test locally without store credentials                            | Added `examples/universal-app/README.md` with web, desktop, Android, and iOS simulator/emulator instructions.                               |
| Be ready for credential-backed CI once credentials are configured                | Added gated Android and iOS workflow jobs controlled by repository variables so native CI can be enabled deliberately.                      |
| Capture data and write a case study                                              | Stored raw evidence under `data/` and summarized findings here.                                                                             |

## Data Captured

Raw evidence is stored in `docs/case-studies/issue-56/data/`.

| File                                                                                                              | Purpose                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `issue-56.json`, `issue-56-comments.json`                                                                         | Issue metadata and comments.                                                    |
| `pr-57.json`                                                                                                      | PR metadata before implementation.                                              |
| `vk-bot-desktop-repo.json`, `vk-bot-desktop-package.json`, `vk-bot-desktop-file-tree.txt`                         | Referenced Electron/React desktop repository metadata.                          |
| `vk-bot-desktop-build-renderer.mjs`, `vk-bot-desktop-electron-main.cjs`, `vk-bot-desktop-js-workflow.yml`         | Relevant desktop app build and workflow patterns.                               |
| `deep-sdk-repo.json`, `deep-sdk-package.json`, `deep-sdk-file-tree.txt`                                           | Referenced Capacitor repository metadata.                                       |
| `deep-sdk-capacitor.config.ts`, `deep-sdk-gh-pages.yml`, `deep-sdk-electron-package.json`                         | Relevant Capacitor, Pages, and desktop packaging patterns.                      |
| `npm-*.json`                                                                                                      | Current npm registry metadata for Vite, Capacitor, and Electron Forge packages. |
| `actions-*-release.json`                                                                                          | Current GitHub Actions major versions checked during implementation.            |
| `recent-merged-prs.json`, `link-foundation-code-search.json`                                                      | Local project history and code-search context.                                  |
| `universal-app-test-before.log`                                                                                   | Failing regression test before the app existed.                                 |
| `universal-app-test-final-2.log`, `npm-test-final-3.log`, `npm-check-final-4.log`                                 | Final Node regression, full test, and quality check logs.                       |
| `example-web-build-final-2.log`, `example-desktop-package-final-2.log`, `example-mobile-sync-final-2.log`         | Final web build, Electron package, and Capacitor sync logs.                     |
| `bun-test-final.log`, `deno-test-final.log`, `check-mjs-syntax-final-2.log`, `check-file-line-limits-final-2.log` | Cross-runtime and repository policy check logs.                                 |
| `validate-changeset-final.log`, `changeset-status-after-stage.log`                                                | Changeset validation and status logs.                                           |
| `../artifacts/universal-app-web.png`, `../artifacts/universal-app-mobile.png`                                     | Browser screenshots from Playwright verification.                               |

## Research Findings

`vk-bot-desktop` provides a useful desktop pattern: keep the React renderer
build as an explicit script, load the built HTML from Electron with
`contextIsolation: true` and `nodeIntegration: false`, and expose packaging
commands for each target platform. This PR follows the same separation of web
bundle and Electron shell, while using Electron Forge for a compact example
configuration.

`deep-foundation/sdk` provides a useful Capacitor pattern: build/export web
assets first, then copy or sync the output into native Android/iOS projects.
This PR keeps generated native projects out of the template, because downstream
apps must customize app IDs, icons, signing, privacy metadata, and store
configuration before those projects should be committed.

Official Vite deployment documentation says repository GitHub Pages deployments
need a `base` path of `/<repo>/`, while root/custom-domain Pages deployments can
use `/`. The example uses `GITHUB_PAGES=true` in CI to switch from local
relative assets to the repository Pages base path.

GitHub Pages documentation confirms that custom build processes can deploy via
GitHub Actions and that the deployed artifact must include an entry file at the
artifact root. The example workflow uploads `examples/universal-app/dist`, which
contains `index.html` at the root.

Capacitor v8 documentation currently describes the same workflow used here:
install Capacitor into a web app, keep a built web assets directory, run
`npx cap sync`, and use platform-specific tooling for Android/iOS builds. The
example pins Capacitor 7 instead of v8 because this template supports Node 20
and Capacitor 8 requires Node 22+.

Electron documentation and Electron Forge documentation both recommend GitHub
Release publishing for distributing desktop build artifacts. The example UI
therefore links to the latest GitHub release rather than inventing a custom
download server.

## Solution Plan

1. Add a regression test defining the expected app files, scripts, workflow, and
   documentation. This reproduced the missing universal app support.
2. Add a nested `examples/universal-app` package so React, Electron, and
   Capacitor dependencies remain optional for users who only need a library.
3. Implement a Vite React UI that imports the package API from `src/index.js`.
4. Add Electron Forge files for secure desktop packaging.
5. Add Capacitor config and scripts for Android/iOS generation, sync, run, and
   build commands.
6. Add a GitHub Actions workflow that builds the web app, deploys Pages on
   `main`, packages Electron artifacts, and exposes gated native mobile jobs.
7. Document local web, desktop, Android, and iOS validation steps.

## Alternatives Considered

| Option                                                        | Tradeoff                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Put React/Electron/Capacitor dependencies in the root package | Rejected because this template remains a small library package by default.                                    |
| Commit generated `android/` and `ios/` folders                | Rejected because generated native projects need downstream app identity, icons, signing, and privacy choices. |
| Use latest Capacitor 8 and Electron 42                        | Rejected because both currently require Node 22+, while this template declares Node 20 support.               |
| Use only documentation without executable examples            | Rejected because the issue asks for actual build support and local verification.                              |

## Verification

Local commands run for this PR:

```bash
npm install
npm install --prefix examples/universal-app
node --test --test-timeout=30000 tests/universal-app.test.js
npm test
npm run check
npm run example:web:build
npm run example:desktop:package
npm run example:mobile:sync
bun test --timeout 30000
deno test --allow-read
bash scripts/check-mjs-syntax.sh
bash scripts/check-file-line-limits.sh
node scripts/validate-changeset.mjs
```

The initial regression test failed before the app files existed and passed after
the implementation. Browser verification was run with Playwright for desktop
and mobile widths, with screenshots stored in `artifacts/`.

## References

- Vite GitHub Pages deployment: https://github.com/vitejs/vite/blob/main/docs/guide/static-deploy.md#github-pages
- GitHub Pages with Actions: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- Capacitor installation and sync workflow: https://capacitorjs.com/docs/getting-started
- Capacitor development workflow: https://capacitorjs.com/docs/basics/workflow
- Capacitor Android docs: https://capacitorjs.com/docs/android
- Capacitor iOS docs: https://capacitorjs.com/docs/ios
- Electron Forge GitHub publisher: https://www.electronforge.io/config/publishers/github
- Electron publishing guide: https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating
