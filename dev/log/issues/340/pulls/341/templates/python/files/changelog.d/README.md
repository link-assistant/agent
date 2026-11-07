# Changelog Fragments

This directory contains changelog fragments that will be collected into `CHANGELOG.md` during releases.

## How to Add a Changelog Fragment

When making changes that should be documented in the changelog, create a fragment file:

```bash
# Create a new fragment (recommended - auto-generates filename with branch/timestamp)
scriv create

# Or manually create a file matching the pattern: YYYYMMDD_HHMMSS_username.md
```

## Fragment Format

Each fragment should contain relevant sections. Uncomment and fill in the appropriate sections:

```markdown
### Added
- Description of new feature

### Changed
- Description of change to existing functionality

### Fixed
- Description of bug fix

### Removed
- Description of removed feature

### Deprecated
- Description of deprecated feature

### Security
- Description of security fix
```

## Why Fragments?

Using changelog fragments (similar to [Changesets](https://github.com/changesets/changesets) in JavaScript):

1. **No merge conflicts**: Multiple PRs can add fragments without conflicts
2. **Per-PR documentation**: Each PR documents its own changes
3. **Automated collection**: Fragments are automatically collected during release
4. **Consistent format**: Template ensures consistent changelog entries

## During Release

Fragments are automatically collected into `CHANGELOG.md` by running:

```bash
scriv collect --version X.Y.Z
```

This is handled automatically by the release workflow.

## Pull Request Validation

Changes under `src/`, `tests/`, or `scripts/` require a newly added, committed
`changelog.d/*.md` fragment. Markdown documentation, `docs/`, `examples/`, and
`experiments/` remain exempt. Existing, modified-in-place, unchanged moved, and
untracked fragments do not satisfy this requirement. Deleting a pending fragment
and adding one with different content counts as a new fragment, even when the
two files are similar. Each new fragment must have a visible category heading
and a description below it; commented templates are invalid.

CI runs `scripts/validate_changeset.py` against the pull request's head commit
and its verified merge base with the base commit. It checks only newly added
fragments and reads their committed content. Missing refs, unrelated histories,
and failed Git commands return exit 1 rather than skipping validation.

To run the same check locally after committing your changes:

```bash
git fetch origin main
python scripts/validate_changeset.py --base-ref origin/main --head-ref HEAD
```

The default refs are `origin/main` and `HEAD`. CI can provide `GITHUB_BASE_SHA`
and `GITHUB_HEAD_SHA`; `GITHUB_BASE_REF` is also supported as an `origin/` branch
fallback. Explicit command-line refs override these defaults. The script uses
local Git history, so a full-history checkout is required. Add `--verbose` to
print Git commands when investigating a failed comparison. In a multi-language
repository, invoke `python/scripts/validate_changeset.py` with the same refs.
