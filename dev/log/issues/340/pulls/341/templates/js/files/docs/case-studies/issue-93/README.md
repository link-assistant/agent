# Issue 93 Case Study: Code Is Not a Change Log

## Data Collected

Raw research snapshots are stored in `data/`:

- `issue-93.json` and `issue-93-comments.json`: issue body and discussion.
- `pr-94.json`: prepared pull request metadata and initial CI checks.
- `ci-runs-issue-93.json`: branch workflow runs captured before implementation.
- `link-foundation-eslint-rules-search.json`: org code search for existing
  local ESLint rule patterns.
- `link-foundation-no-changelog-comments-search.json`: org code search for an
  exact existing rule name.
- `merged-prs-eslint.json` and `merged-prs-case-study.json`: recent related
  merged pull requests for local style.
- `npm-search-eslint-changelog-comments.json`: npm search for related ESLint
  packages.

Additional online references reviewed on 2026-06-26:

- ESLint custom rule documentation:
  <https://eslint.org/docs/latest/extend/custom-rules>
- ESLint flat-config plugin documentation:
  <https://eslint.org/docs/latest/use/configure/plugins>
- ESLint core `no-warning-comments` rule:
  <https://eslint.org/docs/latest/rules/no-warning-comments>
- npm package `@eslint-community/eslint-plugin-eslint-comments`:
  <https://www.npmjs.com/package/@eslint-community/eslint-plugin-eslint-comments>
- npm package `@eslint-community/eslint-utils`:
  <https://www.npmjs.com/package/@eslint-community/eslint-utils>

## Requirements

1. Add an ESLint rule named around `no-changelog-comments`.
2. Inspect line comments, block comments, and JSDoc.
3. Inspect string literals and template literal text by default.
4. Default the configured severity to `warn`, because the signal is heuristic.
5. Detect generic source-history phrasing without domain vocabulary.
6. Cover English, Russian, Chinese, and Hindi marker sets.
7. Avoid ASCII `\b` word boundaries around Cyrillic, Devanagari, or CJK text.
8. Treat bare timing words such as `now`, `before`, and `после` as acceptable
   unless paired with a change verb or old/new contrast.
9. Detect explicit PR, pull request, issue, and ISO-date history references.
10. Support options for `languages`, `checkStrings`, `allow`, and
    `allowDatesInStrings`.
11. Provide a reproducing automated test before the implementation.
12. Compile issue research and solution analysis under
    `docs/case-studies/issue-93`.

## Existing Components

ESLint already provides the right extension surface. A local plugin can be
registered directly in flat config, and a rule can use parser-provided comment
tokens plus normal AST visitors for string-like nodes.

The core `no-warning-comments` rule is adjacent but not sufficient. It checks
configured terms such as TODO-style markers in comments, but this issue needs
change-structure heuristics, multilingual markers, allowlists, and optional
string/template scanning.

`@eslint-community/eslint-plugin-eslint-comments` focuses on ESLint directive
comments such as disable/enable pragmas. It is useful context for comment
linting, but it does not solve source-history prose detection.

`@eslint-community/eslint-utils` is a helper package for plugin authors. This
rule is small enough to avoid another dependency.

Org code search found prior local-rule patterns in captured case-study data,
including `require-gh-paginate` examples, but no existing
`no-changelog-comments` rule.

## Solution Options

### Configure `no-warning-comments`

This would be the smallest change, but it only handles simple comment terms. It
does not cover string literals, template literals, or the structural old/new
patterns requested in the issue.

### Add a Source Scanner Script

A separate script could scan raw files with regular expressions. That would be
runtime-agnostic, but it would duplicate ESLint file targeting, produce weaker
locations, and misread syntax more often.

### Add a Local ESLint Rule

This is the chosen solution. It uses ESLint's parser context, reports native
lint messages, can run at warning severity, and supports the requested options
without adding dependencies.

### Publish or Install an External Plugin

No npm or org-search result showed an exact fit for source-history comment and
string detection. Publishing a plugin would be premature until the heuristic is
validated in this template.

## Implemented Plan

1. Added `eslint-rules/no-changelog-comments.js`.
2. Registered it as `local/no-changelog-comments` in `eslint.config.js` with
   warning severity.
3. Added `tests/no-changelog-comments.test.js`, which drives ESLint's `Linter`
   directly against a flat-config fixture.
4. Covered comments, string literals, template literal text, multilingual
   markers, false-positive guardrails, and all requested options.
5. Preserved default-warn behavior so existing warnings train authors without
   failing CI by default.

## Current Warning Baseline

After enabling the rule, `npm run lint` reports warning-level findings in
existing scripts and tests for issue/PR/date history references. That is
expected for the initial rollout and matches the requested `warn` default. A
future ratchet can clean the baseline and opt the rule into `error` or
`--max-warnings 0` once the repository has no intentional warnings.

## Verification

The reproducing test initially failed because the rule module did not exist.
After implementation:

- `node --test --test-timeout=30000 tests/no-changelog-comments.test.js`
  passes.
- `npm test` passes.
- `bun test --timeout 30000` passes.
- `deno test --allow-read` passes; the ESLint `Linter` fixture is exercised
  under Node and Bun because importing ESLint under Deno's documented
  read-only permissions requires additional environment access.
- `npm run check` passes with warning-level rule findings only.
- `bash scripts/check-file-line-limits.sh` passes.
