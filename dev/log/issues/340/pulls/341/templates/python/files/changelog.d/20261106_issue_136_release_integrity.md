### Fixed

- Retry explicit internal GitHub commit_refs_rules and HTTP 429/5xx push failures at most three times with backoff; preserve policy refusals and diagnostics (`RELEASE_DEBUG=1`).
- Retain the validated release SHA, reject source or dependency drift across remote recovery and rebases, and adopt only verified metadata-only release children. Compare the entire repository and parsed TOML/uv lock content in both Python layouts.
