# Case Study: Issue #38 — Tag Prefix Support for Multi-Language Repos

## Timeline / Sequence of Events

1. The JS template was created with `scripts/create-github-release.mjs` and `scripts/format-github-release.mjs`, both hardcoding `v${version}` as the GitHub release tag name.
2. A downstream multi-language repo ([link-assistant/web-capture](https://github.com/link-assistant/web-capture)) encountered tag collisions when using both the JS template and a Rust template side-by-side: the Rust template uses `rust-v<version>` but the JS template used `v<version>`, causing ambiguity.
3. [PR #89](https://github.com/link-assistant/web-capture/pull/89) manually patched the tag in that repo as a workaround.
4. Issue #38 was filed to fix this in the template itself.

## Requirements

1. `scripts/create-github-release.mjs` must support a configurable tag prefix.
2. `scripts/format-github-release.mjs` must support the same configurable tag prefix.
3. The default prefix must remain `v` for backward compatibility.
4. The prefix must be overridable via a `--tag-prefix` CLI argument or `TAG_PREFIX` environment variable.
5. Downstream users of the template can pass `--tag-prefix "js-v"` without modifying the scripts.

## Root Cause

Both scripts hardcoded the tag construction as `` `v${version}` `` with no parameterization. There was no CLI option, environment variable, or configuration to override this.

## Solution

Added `--tag-prefix` option (defaulting to `'v'`, also readable from `TAG_PREFIX` env var) to both scripts:

```js
.option('tag-prefix', {
  type: 'string',
  default: getenv('TAG_PREFIX', 'v'),
  describe: 'Prefix for the git tag (e.g., "js-v" for multi-language repos)',
})
```

Changed tag construction from:

```js
const tag = `v${version}`;
```

to:

```js
const tag = `${tagPrefix}${version}`;
```

Also updated the release `name` field from bare `version` to `tag` so the GitHub UI displays the full tag string (e.g., `js-v1.0.0` instead of `1.0.0`).

## Usage

Default (backward-compatible, same as before):

```sh
node scripts/create-github-release.mjs --release-version 1.0.0 --repository owner/repo
# creates tag: v1.0.0
```

Multi-language repo with JS prefix:

```sh
node scripts/create-github-release.mjs --release-version 1.0.0 --repository owner/repo --tag-prefix "js-v"
# creates tag: js-v1.0.0
```

Via environment variable:

```sh
TAG_PREFIX=js-v node scripts/create-github-release.mjs --release-version 1.0.0 --repository owner/repo
# creates tag: js-v1.0.0
```

## Possible Alternatives Considered

- Hardcode `js-v` as the new default: rejected because it breaks existing repos using `v<version>` tags.
- Use a separate config file: unnecessary complexity for a single scalar value.
- Use workflow-level env var only: less flexible than a CLI arg (harder to override per-step).

## Related

- [link-assistant/web-capture#88](https://github.com/link-assistant/web-capture/issues/88) — downstream issue
- [link-assistant/web-capture#89](https://github.com/link-assistant/web-capture/pull/89) — downstream workaround
