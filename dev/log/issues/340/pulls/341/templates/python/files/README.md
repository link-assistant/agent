# python-ai-driven-development-pipeline-template

A comprehensive template for AI-driven Python development with full CI/CD pipeline support.

[![CI/CD Pipeline](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/workflows/CI/CD%20Pipeline/badge.svg)](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/actions)
[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/downloads/)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

## Features

- **Multi-version Python support**: Works with Python 3.9-3.13
- **Comprehensive testing**: pytest with async support and coverage reporting
- **Code quality**: Ruff (linting + formatting) + mypy (type checking)
- **Pre-commit hooks**: Automated code quality checks before commits
- **CI/CD pipeline**: GitHub Actions CI/CD with Python 3.13
- **Changelog management**: Scriv for conflict-free changelog (like Changesets in JS)
- **Release automation**: Automatic PyPI publishing and GitHub releases
- **API documentation**: Sphinx + opt-in GitHub Pages deploy on push to `main`

## Quick Start

### Using This Template

1. Click "Use this template" on GitHub to create a new repository
2. Clone your new repository
3. Update `pyproject.toml` with your package name and description
4. Rename `src/my_package` to your package name
5. Update imports in tests and examples
6. Install dependencies and start developing!

### Development Setup

```bash
# Clone the repository
git clone https://github.com/link-foundation/python-ai-driven-development-pipeline-template.git
cd python-ai-driven-development-pipeline-template

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install in editable mode with development dependencies
pip install -e ".[dev]"

# Install pre-commit hooks
pip install pre-commit
pre-commit install
```

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=term --cov-report=html

# Run specific test file
pytest tests/test_my_package.py

# Run with verbose output
pytest -v
```

### Code Quality Checks

```bash
# Lint code (check for issues)
ruff check .

# Format code
ruff format .

# Type check
mypy src/

# Check file size limits
python scripts/check_file_size.py

# Run all checks
ruff check . && ruff format --check . && mypy src/ && python scripts/check_file_size.py
```

## Project Structure

```
.
├── .github/
│   └── workflows/
│       ├── docs.yml            # Sphinx build + opt-in GitHub Pages deploy
│       └── release.yml         # CI checks + release automation (PyPI + GitHub)
├── changelog.d/                # Changelog fragments (like .changeset/)
│   ├── README.md               # Fragment instructions
│   └── *.md                    # Individual changelog entries
├── docs/                       # Sphinx documentation source
│   ├── conf.py                 # Sphinx configuration
│   ├── index.md                # Documentation landing page
│   ├── api.md                  # Auto-generated API reference
│   └── requirements.txt        # Documentation build dependencies
├── examples/
│   └── basic_usage.py          # Usage examples
├── scripts/
│   ├── check_file_size.py      # File size validation script
│   ├── bump_version.py         # Version bumping utility
│   ├── version_and_commit.py   # CI/CD version management
│   ├── publish_to_pypi.py      # PyPI publishing script
│   └── create_github_release.py # GitHub release creation
├── src/
│   └── my_package/
│       ├── __init__.py         # Package entry point
│       └── py.typed            # Type marker file
├── tests/
│   ├── __init__.py
│   └── test_my_package.py      # Test suite
├── .gitignore                  # Git ignore patterns
├── .pre-commit-config.yaml     # Pre-commit hooks configuration
├── .ruff.toml                  # Ruff additional configuration
├── pyproject.toml              # Project configuration and dependencies
├── CHANGELOG.md                # Project changelog
├── CONTRIBUTING.md             # Contribution guidelines
├── LICENSE                     # Unlicense (public domain)
└── README.md                   # This file
```

## Design Choices

### Package Management

This template uses modern Python packaging standards:

- **pyproject.toml**: Single source of truth for project configuration
- **hatchling**: Modern build backend (PEP 517)
- **src layout**: Prevents accidental imports from source directory
- **py.typed**: Marks package as type-hinted for mypy

### Code Quality Tools

- **Ruff**: Ultra-fast Python linter and formatter (replaces flake8, black, isort)
  - Configured for strict code quality standards
  - Integrates with pre-commit hooks
  - Consistent formatting across the project

- **mypy**: Static type checker
  - Strict mode enabled for maximum type safety
  - Ensures code correctness before runtime

- **pytest**: Modern testing framework
  - Support for async tests via pytest-asyncio
  - Coverage reporting via pytest-cov
  - Organized test structure with classes

### Pre-commit Hooks

Automated checks run before each commit:

1. Basic checks (trailing whitespace, file endings, etc.)
2. Ruff linting and formatting
3. mypy type checking

This ensures code quality is maintained throughout development.

### Changelog Management (Scriv)

This template uses [Scriv](https://scriv.readthedocs.io/) for changelog management, which works similarly to [Changesets](https://github.com/changesets/changesets) in JavaScript projects:

- **Fragment-based**: Each PR adds a changelog fragment to `changelog.d/`
- **Conflict-free**: Multiple PRs can add fragments without merge conflicts
- **Auto-collection**: Fragments are automatically merged during release
- **Category-based**: Supports Added, Changed, Deprecated, Removed, Fixed, Security

```bash
# Create a changelog fragment (similar to `npx changeset`)
scriv create

# View pending fragments
ls changelog.d/*.md
```

### CI/CD Pipeline

The GitHub Actions workflow provides:

1. **Linting**: Ruff linting, formatting, and mypy type checking
2. **Changelog check**: Requires a newly added, valid fragment for source-changing PRs, using a verified Git merge base (see [validation details](changelog.d/README.md#pull-request-validation))
3. **Testing**: Python 3.13 test suite
4. **Building**: Package building and validation
5. **Coverage**: Automatic upload to Codecov

Shell and JSON changes activate the code checks. Changes under `docs/`,
`changelog.d/`, `dev/log/`, `examples/`, and `experiments/` remain excluded.
Dependabot PRs are exempt from the fragment requirement by authenticated author;
branch names do not grant an exemption. Standalone shell scripts are checked
with pinned ShellCheck in CI and pre-commit.

Security checks probe dependency review availability first. A disabled Dependency
graph warns on PRs and fails pushes to main and scheduled runs with the setting
an administrator must enable: Settings → Code security → Dependency graph.
Transient API failures are retried and reported as unknown, without claiming the
setting is disabled. Set `DEPENDENCY_GRAPH_DEBUG=1` for response tracing.

### Runner and link-check policy

Ubuntu jobs and Linux matrix entries use `ubuntu-24.04`. A workflow regression
check rejects floating Ubuntu, Windows, and macOS runner aliases; upgrades
should change the versioned labels in a reviewed pull request.

The Broken Link Checker rechecks transport errors and HTTP 429/5xx responses,
including cached failures, with exponential backoff capped at 30 seconds under
`RECHECK_BUDGET_SECONDS` (240 seconds by default). Other HTTP failures remain
final. Throttled `github.com` blob/tree links also use the GitHub Contents API
with the workflow's read-only `GITHUB_TOKEN`; only an API 200 confirms recovery.
Slash-containing refs must be percent-encoded in their URL segment for this
fallback. Missing content and persistent outages still fail the workflow.
Set `RECHECK_VERBOSE=true` to log each attempt; `RECHECK_WAIT_MS` adjusts the
initial backoff (2000 milliseconds by default).

Lychee scans the repository directory for Markdown and HTML, respecting ignored
paths without warning when an extension is absent. Besides pushes and pull
requests that touch those files, the checker runs every Monday at 06:00 UTC, so
links that rot without a commit are still reported. Its cache is keyed by UTC
day: runs on the same day reuse results, and lychee never has to discard a cache
older than its one-day `--max-cache-age`. Failed runs retain the
`lychee-report` artifact.

### API Documentation

API documentation is built with [Sphinx](https://www.sphinx-doc.org/) and can be
deployed to GitHub Pages on pushes to `main`. Pull requests build the docs
(without deploying) to catch regressions before they merge.

```bash
# Install docs dependencies
pip install -e ".[docs]"

# Build locally (output goes to _site/)
sphinx-build -W --keep-going -b html docs _site

# Preview in a browser
python -m http.server --directory _site 8000
```

The Sphinx config in `docs/conf.py` autodiscovers `src/my_package` via
`sphinx.ext.autodoc` + `sphinx.ext.autosummary` and renders Google-style
docstrings with `sphinx.ext.napoleon`. When you bootstrap a new repository from
this template, update `project`, `author`, and the autosummary target in
`docs/conf.py` and `docs/api.md` to point at your package.

#### Deploying API documentation

The `Docs` workflow (`.github/workflows/docs.yml`) builds on every push and
pull request. On `push` to `main`, it deploys to GitHub Pages only when the
repository variable `DEPLOY_GITHUB_PAGES` is set to `true`. This keeps fresh
repositories green while still validating their docs before Pages is configured.

**One-time setup per repository**:

1. Open `Settings -> Pages` and set `Source = GitHub Actions`.
2. Open `Settings -> Secrets and variables -> Actions -> Variables`, then add
   repository variable `DEPLOY_GITHUB_PAGES` with value `true`.

Without the variable, the workflow logs a notice and skips deployment without
failing. Without the Pages source setting, an opted-in deploy fails with HTTP
404, the GitHub request ID and a link to the Pages settings. The Pages source
setting cannot be configured from a workflow.

The deploy job publishes with the local `.github/actions/deploy-pages` action,
which speaks the REST protocol of `actions/deploy-pages@v5` using only Node.js
built-ins. The build job outputs the ID of the `github-pages` artifact it
uploaded, and the deploy job publishes exactly that artifact. A transient
HTTP 5xx, HTTP 429 or lost connection while creating the deployment is retried
up to three times, 10 and 20 seconds apart. Before each retry the action looks
up the deployment of the commit SHA and adopts it unless it failed, so one
commit is never deployed twice. A refusal (any other 4xx) fails at once with
the status and request ID. Status polling, the 10-minute timeout and
cancellation match `actions/deploy-pages@v5`.

### Preview regeneration parity

[Issue #9](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/9)
tracks parity with the browser preview-regeneration pattern from the JavaScript
template. This Python template does not ship a browser-rendered example app, so
it intentionally does not install Playwright or add a screenshot workflow yet.
When such a surface is added, use the Python porting checklist in
[`docs/preview-regeneration.md`](docs/preview-regeneration.md).

### Release Automation

The release workflow (`release.yml`) provides:

1. **Integrated CI checks**: Waits for lint, test, build, release preflight, and
   any applicable documentation, changelog, and Docker build checks
2. **Auto-release on push**: Publishes when the current PyPI version or GitHub
   release is missing, so interrupted releases can resume
3. **Manual release**: Trigger releases via workflow_dispatch (default: patch)
4. **Fragment collection**: Automatically collects changelog fragments
5. **PyPI publishing**: OIDC trusted publishing (no tokens needed); existing
   uploads are skipped when retrying a partial release
6. **Published package smoke test**: Installs the just-published PyPI package
   into a clean virtualenv and verifies imports/console scripts
7. **GitHub releases**: Automatic creation with CHANGELOG content
8. **Optional multi-architecture Docker images**: When a `Dockerfile` exists,
   set the `DOCKERHUB_IMAGE` and `DOCKERHUB_USERNAME` repository variables and
   the `DOCKERHUB_TOKEN` secret to publish native `linux/amd64` and
   `linux/arm64` images after each GitHub release

All releases require successful lint, test, build, and credential preflight.
Failures or cancellations in any required check prevent publishing; checks that
do not apply to the event may skip. Release writers share a non-cancelling queue
that holds up to 100 pending jobs.

PyPI preflight exchanges an OIDC token before publishing. A missing trusted
publisher fails with the owner, repository, workflow, blank environment, and the
appropriate existing-project or pending-publisher settings URL. Rename
`[project].name` first if the template's `my-package` project is not yours.
Rate limits and inconclusive token errors remain unknown. PR probes report
credential problems as advisory because forks may not have publishing secrets.

Both automatic and manual releases wait up to ten minutes for the exact PyPI
version to appear before running the installation smoke test. A timeout explains
that the upload step succeeded and the release can be retried safely. A tag by
itself does not satisfy the release gate. Published GitHub releases are preserved;
an existing draft is published when recovery reaches that step. Root packages
use `v` tags; packages under `python/` use `py_v` tags.

For local propagation diagnostics, enable optional retry tracing:

```bash
python scripts/check_release.py wait --package-name my-package --version 0.1.0 --verbose
```

Every checkout inherits Git's `init.defaultBranch=main` configuration. Workflow
shell steps receive layout and release values through environment variables.
The workflow audit uses one pinned zizmor version at low confidence, and the
secretlint CLI and preset have matching exact versions. CodeQL excludes
`experiments/` and `python/experiments/` while retaining shipped code and workflows.
Lychee limits `github.com` to two simultaneous requests with a one-second request
interval. Its commented `.lycheeignore` starts empty; transient 429/5xx responses
still require successful recovery and otherwise fail the existing link gate.

## Configuration

### Updating Package Name

After creating a repository from this template:

1. Update `pyproject.toml`:
   - Change `name` field
   - Update `project.urls`
   - Update `tool.hatch.build.targets.wheel.packages`

2. Rename `src/my_package/` directory to your package name

3. Update imports:
   - `tests/test_my_package.py`
   - `examples/basic_usage.py`
   - `.ruff.toml` (known-first-party)

### Ruff Configuration

Customize Ruff in `pyproject.toml` under `[tool.ruff]`. Current configuration:

- 88-character line length (Black-compatible)
- Comprehensive linting rules (E, W, F, I, N, UP, B, etc.)
- Strict equality enforcement
- Automatic import sorting

### mypy Configuration

Configured in `pyproject.toml` under `[tool.mypy]`:

- Strict mode enabled
- No implicit optionals
- Warn on unused ignores
- Full type checking coverage

### pytest Configuration

Configured in `pyproject.toml` under `[tool.pytest.ini_options]`:

- Test discovery in `tests/` directory
- Source path includes `src/`
- Strict marker enforcement
- Coverage configuration included

## Scripts Reference

| Script                         | Description                              |
| ------------------------------ | ---------------------------------------- |
| `pytest`                       | Run all tests                            |
| `pytest --cov=src`             | Run tests with coverage                  |
| `ruff check .`                 | Lint code                                |
| `ruff format .`                | Format code                              |
| `mypy src/`                    | Type check code                          |
| `python scripts/check_file_size.py` | Check file size limits             |
| `pre-commit run --all-files`   | Run all pre-commit hooks                 |
| `scriv create`                 | Create a changelog fragment              |
| `scriv collect --version X.Y.Z`| Collect fragments into CHANGELOG.md      |

## Example Usage

```python
from my_package import add, multiply, delay
import asyncio

# Basic arithmetic
result = add(2, 3)  # 5
product = multiply(2, 3)  # 6

# Async operations
async def main():
    await delay(1.0)  # Wait for 1 second

asyncio.run(main())
```

See `examples/basic_usage.py` for more examples.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Run quality checks: `ruff check . && ruff format . && mypy src/ && pytest`
5. Commit your changes (pre-commit hooks will run automatically)
6. Push and create a Pull Request

## Testing

This project maintains high test coverage and uses pytest for testing:

- Unit tests for all functions
- Async test support
- Coverage reporting
- Cross-platform compatibility testing

## License

[Unlicense](LICENSE) - Public Domain

This is free and unencumbered software released into the public domain. See [LICENSE](LICENSE) for details.

## Acknowledgments

Inspired by [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template).

## Resources

- [Python Packaging Guide](https://packaging.python.org/)
- [pytest Documentation](https://docs.pytest.org/)
- [Ruff Documentation](https://docs.astral.sh/ruff/)
- [mypy Documentation](https://mypy.readthedocs.io/)
- [Pre-commit Documentation](https://pre-commit.com/)
- [Scriv Documentation](https://scriv.readthedocs.io/)
