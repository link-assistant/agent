### Added

- Added a `zizmor` job to the `Workflows` workflow and a `.github/zizmor.yml`
  policy file. `actionlint` validates workflow schema and shell; it does not
  detect credential persistence, template injection or unpinned actions, so
  those defects previously shipped into every repository generated from this
  template (closes #64). The policy tag-pins the publishers whose release tags
  the template is meant to read at a glance (`actions/*`, `github/*`,
  `docker/*`, `astral-sh/*`, `lycheeverse/*`, `zizmorcore/*`) and requires a
  full commit hash for everything else.

### Fixed

- Set `persist-credentials: false` on every `actions/checkout` step except the
  one in `manual-release`, which pushes the version bump commit and therefore
  needs the token in `.git/config`. Previously all 17 checkouts wrote the
  `GITHUB_TOKEN` into the working tree, where any later step in the same job
  could read it.
- Hash-pinned `pypa/gh-action-pypi-publish` (was `@release/v1`, a mutable
  branch executing in the PyPI trusted-publishing job) and
  `codecov/codecov-action`, each annotated with the tag and date pinned.
- Moved `pages: write` and `id-token: write` in `docs.yml` from the workflow
  level to the two jobs that publish, so the build job no longer carries write
  scopes it does not use.
