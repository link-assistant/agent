---
'@link-assistant/agent': patch
---

Replace withdrawn free model defaults with Kilo Nemotron 3 Super, refresh Kilo and Zen built-ins, stop retrying Zen FreeTierError responses, and check both provider catalogs daily for model drift.

Override the pinned Solid runtime's Seroval dependency with patched 1.6.9 to resolve critical deserialization advisories. Refresh direct dependencies, including current OpenTUI, AI SDK, and command-stream releases. Keep Solid and web-tree-sitter pinned to the versions required by OpenTUI, linking the active upstream parser compatibility issue.

Run bash tool commands through command-stream in the platform shell, with one AbortSignal for timeout and caller abort, process-tree cancellation (stopping the Windows process tree with taskkill until command-stream does), and live output streaming.

Validate the shipped default model, single compaction model, and expanded cascade against live provider catalogs or non-deprecated models.dev metadata in CI and daily, with JavaScript/Rust parity coverage.
