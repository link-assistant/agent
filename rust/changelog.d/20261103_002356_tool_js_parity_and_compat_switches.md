---
bump: minor
---

### Added

- Tool compatibility switches, each an environment variable with a
  matching CLI flag: `LINK_ASSISTANT_AGENT_BASH_SHELL` (`--bash-shell`),
  `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT` (`--legacy-tool-output`),
  `LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING` (`--legacy-edit-matching`),
  `LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS`, `LINK_ASSISTANT_AGENT_GREP_HIDDEN`,
  `LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS`, `LINK_ASSISTANT_AGENT_READ_MAX_LINES`,
  `LINK_ASSISTANT_AGENT_READ_MAX_BYTES`, `LINK_ASSISTANT_AGENT_READ_ONLY` and
  `LINK_ASSISTANT_AGENT_DISABLE_TOOLS` (#335). The legacy switches restore
  the behaviour of earlier releases where it differs from the JavaScript
  tools.
- `bash` metadata reports `timedOut`, `aborted` and `description`.

### Changed

- `edit` uses the JavaScript replacers: a block-anchor match picks the most
  similar block, a fuzzy match must be unique and much larger spans are
  refused; a UTF-8 BOM is kept out of matching; `metadata.diff` is the
  jsdiff `createTwoFilesPatch` output with common indentation removed and
  `filediff` keeps the file's own line endings; missing files, directories
  and an empty `filePath` give the JavaScript errors.
- `grep` without `output_mode` prints the JavaScript listing (matches
  grouped by file, newest first, at most 100), accepts `include`, honours
  `.gitignore`/`.ignore` and stops after the time limit.
- `glob` lists files like `rg --files`: absolute paths, newest first, at
  most 100, "No files found" when there are none.
- `list` uses the JavaScript ignore globs and `.gitignore`/`.ignore`.
- `read` splits lines and handles an empty file, a BOM, NFC file names and
  numeric-string parameters as JavaScript does, and streams the file.
- `bash` picks a POSIX shell from `$SHELL`, closes stdin and kills the whole
  process group on timeout.
- `webfetch` uses the JavaScript error messages.
- `todowrite` accepts the JavaScript todo schema.

### Fixed

- `permission` no longer panics on non-ASCII text before `&&` or `||`.
- The filesystem `contains` fallback compares whole path components.
- An empty given id generates a new id.
- `batch` reports every call past the limit of 10.
- `websearch` treats `numResults: 0` as 8 and validates `livecrawl`/`type`.
- `webfetch` skips `<script>`/`<style>` tags with attributes and keeps byte
  offsets valid in non-ASCII HTML during markdown conversion.
