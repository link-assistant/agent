# Preview Regeneration Parity

[Issue #9](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/9)
tracks parity with the preview-regeneration pattern from
[link-foundation/js-ai-driven-development-pipeline-template#62](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/62).
The JavaScript template uses `browser-commander` with Playwright to refresh
README, GitHub Pages, and Open Graph preview images from a real browser render.

## Current Status

This Python template does not ship a browser-rendered example app. It currently
contains a package scaffold, release tooling, examples, and Sphinx API docs, but
no UI surface whose screenshots can drift. For that reason the template
intentionally does not add Playwright dependencies, browser binary installation,
or a no-op screenshot workflow yet.

`browser-commander` is JavaScript-only. When this template gains a browser app
surface, port the pattern with
[`playwright-python`](https://playwright.dev/python/) directly instead of adding
Node-only tooling to the Python template.

## Activation Criteria

Add preview-regeneration automation when the template includes at least one of:

- A README or documentation screenshot generated from an example app UI.
- A GitHub Pages site with static preview images.
- An `og:image` or social sharing image generated from app state.
- A browser-rendered example that has a meaningful locale x theme matrix.

Until one of those surfaces exists, documentation-only tracking is the intended
state for issue #9.

## Python Port Checklist

When a browser-rendered example app is added, the port should include:

1. A script such as `scripts/update_preview_images.py` that serves the built
   app locally and drives Chromium with `playwright-python`.
2. A deterministic matrix for locale x theme captures, matching the JavaScript
   template's intent while using Python-native APIs.
3. Generated screenshots under `docs/screenshots/` or another documented
   location that README and docs reference directly.
4. Verbose diagnostics behind `PREVIEW_VERBOSE=1`, including resolved URL,
   locale, theme, page title, and screenshot dimensions.
5. CI drift detection using `git status --porcelain`, with expected screenshot
   paths staged explicitly before any automatic commit.
6. Failure artifacts for generated screenshots and Playwright traces so CI
   failures are diagnosable without rerunning locally.

## Workflow Policy

The future workflow should run on `push` to `main` and `workflow_dispatch`.
Pull requests should either verify the screenshot script without committing
drift, or upload generated images as artifacts for review. If a push-to-main
job commits refreshed images, use `[skip ci]` to avoid an infinite workflow
loop and stage only generated preview artifacts.
