# Contributing to js-ai-driven-development-pipeline-template

## Development Workflow

Use Node.js 24 with npm 10.9 or newer for development and release tooling.
Changesets 3 requires a supported Node.js 22.11, 24, or 26+ runtime.

1. **Fork the repository** and clone your fork
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Install dependencies**: `bun install` (or `npm install`)
4. **Make your changes**
5. **Run local checks**: `bun run check`
6. **Create a changeset**: `bun run changeset`
7. **Commit and push** (pre-commit hooks will run automatically)
8. **Create a Pull Request**

## Code Standards

### File Size Limits

**Maximum 1500 lines per file** (enforced via ESLint `max-lines` rule and CI `check-file-line-limits` job).

This benefits both AI and human developers by ensuring files remain readable and maintainable.

### Formatting and Linting

All code must pass:

```bash
# Check formatting
bun run format:check

# Check linting
bun run lint

# Run all checks
bun run check
```

The pre-commit hook runs automatically, but you can also manually format and fix:

```bash
# Auto-fix formatting
bun run format

# Auto-fix lint issues
bun run lint:fix
```

### Testing Requirements

Tests should:

- Cover critical paths
- Work across all runtimes (Node.js, Bun, Deno)
- Use the [test-anywhere](https://github.com/link-foundation/test-anywhere) framework

```bash
# Run tests
bun test --timeout 30000
npm test
deno test -A --parallel
```

## Version Management with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs. This eliminates merge conflicts that occur when multiple PRs bump the version in `package.json`.

### Adding a Changeset

When you make changes that affect users, add a changeset:

```bash
bun run changeset
# or
npm run changeset
```

This will prompt you to:

1. Select the type of change (patch/minor/major)
2. Provide a summary of the changes

The changeset will be saved as a markdown file in `.changeset/` and should be committed with your PR.

### Changeset Guidelines

| Type      | When to Use                          | Examples                                            |
| --------- | ------------------------------------ | --------------------------------------------------- |
| **Patch** | Bug fixes, internal changes          | Fix typo, update dependency, refactor internal code |
| **Minor** | New features, non-breaking additions | Add new function, new optional parameter            |
| **Major** | Breaking changes                     | Remove function, change API signature               |

Example changeset summary:

```markdown
Add support for custom configuration via config file
```

### What Changes Need Changesets?

**Required** for:

- Bug fixes
- New features
- Breaking changes
- Public API changes

**Not required** for:

- Documentation-only changes (in `./docs` folder)
- Changes to markdown files
- CI/CD workflow updates (unless they affect users)

### PR guard comparison and local validation

Version and changeset guards compare the PR head with its merge base. CI passes
`GITHUB_BASE_SHA` and `GITHUB_HEAD_SHA`; local runs default to `origin/main` and
`HEAD`. Fetch the base before running the guards. Missing refs, Git failures,
and invalid package metadata fail validation.

The changeset guard counts added fragments only. Exact file moves do not count
as new fragments; replacing a deleted fragment with different content does.
Both paths of a move are checked when deciding whether code requires a fragment.
Markdown, `docs/`, `examples/`,
`experiments/`, `dev/log/`, and changeset metadata are exempt. In multi-language
repositories, unrelated language roots are exempt; shared workflows still
require a fragment. For local directory validation without Git comparison, use
`ALLOW_LOCAL_CHANGESET_SCAN=true node scripts/validate-changeset.mjs`. This
explicit mode is forbidden in CI. Set `DEBUG=1` to print comparison details.

Automated release PRs are exempt only when their author matches the release
actor, both repositories match `GITHUB_REPOSITORY`, and their branch uses a
release prefix. The default author is `github-actions[bot]`. When a dedicated
release token creates PRs as another account, configure repository variable
`RELEASE_PR_ACTOR` to that account's exact login. A branch name alone never
grants an exemption.

## Release Process

The release process is fully automated:

1. **PR with changeset merged** - The changeset is added to `.changeset/`
2. **CI detects changesets** - On push to main, CI checks for pending changesets
3. **Version bump** - Package version is updated based on changeset type
4. **Changelog update** - `CHANGELOG.md` is updated automatically
5. **npm publish** - Package is published via OIDC trusted publishing
6. **GitHub Release** - A release is created with formatted notes

Changesets explicitly uses Prettier in `.changeset/config.json`, matching
`format:check`. Keep that setting when adding runtime configs: auto-detection
selects Deno for any `deno.json`, independently of the npm package-manager
declaration. PR lint checks dry-run `npm run changeset:version` after the fresh
merge simulation and restore the generated metadata and consumed fragments.
This requires no publishing credentials and runs independently of release
credential preflight.

### Multiple Changesets

If multiple PRs are merged before a release:

- All changesets are merged into one
- The highest version bump type wins (major > minor > patch)
- All descriptions are preserved in chronological order

## Pull Request Guidelines

### PR Title

Use a clear, descriptive title that summarizes the change:

```
feat: Add support for custom configuration
fix: Resolve race condition in async handler
docs: Update API documentation for v2
```

### PR Description

Include:

- **What** - Describe the change
- **Why** - Explain the motivation
- **Testing** - How the change was tested

### CI Checks

All PRs must pass:

- [ ] Test compilation (syntax check)
- [ ] Lint, format, and secrets scan
- [ ] File line limits check
- [ ] Changeset validation (for code changes)
- [ ] Documentation validation (when docs change)
- [ ] Tests on all platforms (Ubuntu, macOS, Windows)
- [ ] Tests on all runtimes (Node.js, Bun, Deno)

### Fresh Merge Simulation

The CI workflow automatically:

1. Merges the latest `main` into your PR branch
2. Runs checks against the merged state

If this fails with merge conflicts, you need to:

```bash
git fetch origin main
git merge origin/main
# Resolve conflicts
git push
```

## Questions?

If you have questions about contributing, feel free to open an issue for discussion.

## JavaScript-first mixed-language projects

Follow [the JavaScript-first gate and single push workflow](javascript-first.md) before enabling production Rust jobs for a mixed-language project.

Standalone shell scripts and Husky hooks are checked with ShellCheck 0.11.0.
Install [pipx](https://pipx.pypa.io/stable/how-to/install-pipx.html) for the staged-file hook;
it runs the same pinned `shellcheck-py==0.11.0.1` package as CI. To check all shell
files locally, run:

```sh
git ls-files -z '*.sh' '.husky/*' | xargs -0 pipx run --spec shellcheck-py==0.11.0.1 shellcheck
```

Release scripts load `command-stream` and `lino-arguments` from installed,
lockfile-pinned development dependencies. Run `npm ci` before invoking them;
they do not download or install helpers at runtime. Keep both `package-lock.json`
and `deno.lock` synchronized when updating these dependencies. CI runs its pinned
secrets scan after Node setup and before installing project dependencies, so the
scanner and its preset resolve from the same npm execution tree.

Shell scripts and Git hooks use LF on every platform through `.gitattributes`.
The prepare script calls Husky's installed API and verifies `core.hooksPath`.
Set `CI_SCRIPTS_DEBUG=1` for optional dependency and hook installation tracing.

### Dependency advisories

The Security workflow audits every committed npm lock with
`scripts/npm-audit-report.mjs`. Every advisory, at any severity, becomes an
annotation and a row in the step summary, so a green run states what it
accepted. Pull requests and pushes fail at `high`, the same level as
`dependency-review`: a moderate advisory with no patched release would
otherwise block every contributor. The weekly scheduled run also fails on a
moderate advisory that `npm audit fix` resolves without `--force`. Fix it with
`npm update <package>` or an `overrides` entry. When only a breaking upgrade
would remove an advisory, the run stays green and keeps reporting it.

### Dependency install scripts and syntax coverage

Every dependency with an install script needs an explicit `allowScripts`
decision in its owning package manifest. Approvals pin the exact locked version
(`"esbuild@0.25.12": true`); denials name the package (`"node-pty": false`).
Vite's esbuild binary, macOS fsevents and the Electron installer are approved.
The optional node-pty adapter is denied because the pipeline scripts only use
command-stream's ordinary process API; this keeps the default behavior without
silently enabling a native compilation. Review new versions before approving
them. `tests/ci-audit-regressions.test.js` checks all three npm lockfiles,
including optional platform-specific packages.

Deno reads its own install-script policy from `deno.json`; npm's decision does
not apply to it. Its version-pinned denial keeps the unused PTY build off.
Every CI runtime leg pins Node 24 and installs the root and
`.github/actions/artifact-transport` locks with `npm ci`. The Deno leg also
prepares its frozen module graph with `deno test -A --parallel --no-run --frozen`
before the timed suite, which still runs every test within its existing budget.

`bash scripts/check-mjs-syntax.sh` checks all tracked `.js`, `.mjs` and `.cjs`
files recursively, including shipped examples and local actions. Historical
case studies and development logs are data outside this gate. An empty
inventory or a failed file check is an error. CodeQL also scans the shipped
examples. Deprecated dependencies are not allowlisted: replace or override
them. Artifact compatibility decisions and their probes are
documented in the [artifact action](../.github/actions/artifact-transport/README.md);
desktop ones in [universal-app/compat](../examples/universal-app/compat/README.md).
