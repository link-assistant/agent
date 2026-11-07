# Research Notes for Issue #3

## Changesets Documentation Research

### Sources

- Official Changesets GitHub: https://github.com/changesets/changesets
- Changesets Detailed Explanation: https://github.com/changesets/changesets/blob/main/docs/detailed-explanation.md
- NPM Package: https://www.npmjs.com/package/@changesets/cli
- LogRocket Guide: https://blog.logrocket.com/version-management-changesets/

### Key Findings

1. **Changesets Structure**
   - Changesets use YAML front matter to declare package changes and semver bump types
   - The CLI generates CHANGELOG.md files with section headers for each bump type
   - Headers are: "### Major Changes", "### Minor Changes", "### Patch Changes"

2. **CHANGELOG Generation**
   - The `changeset version` command creates/updates CHANGELOG.md
   - Changes are grouped by bump type (Major/Minor/Patch)
   - Each section includes commit hashes and descriptions

3. **Release Process**
   - Changesets are created during development
   - Version command aggregates changesets into CHANGELOG
   - Publish command handles NPM publishing and git tagging

4. **The Problem**
   - Changesets CHANGELOG format is optimized for CHANGELOG.md files
   - Section headers are useful for organizing large changelogs
   - However, for GitHub Releases, these headers are redundant
   - Release version already indicates the bump type (e.g., 0.1.0 is minor)
