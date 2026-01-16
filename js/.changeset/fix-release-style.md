---
'@link-assistant/agent': patch
---

Fix GitHub release style to match template repository standards

- Fix release name format to use `[js]` prefix instead of `js ` (e.g., `[js] 0.8.4` instead of `js 0.8.4`)
- Fix changelog path for js releases to use `js/CHANGELOG.md` instead of root `CHANGELOG.md`
- This ensures release descriptions contain actual changelog content with PR links and npm badges

Fixes #121
