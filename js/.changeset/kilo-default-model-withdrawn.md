---
'@link-assistant/agent': patch
---

fix: default to `kilo/nemotron-3-ultra-free` after Kilo withdrew Nemotron 3 Super (#335)

- The default model and default compaction model are now
  `kilo/nemotron-3-ultra-free` (1M context); the default compaction cascade is
  `(kilo/nemotron-3-ultra-free kilo/nemotron-3.5-lightning-free same)`.
- `nemotron-3-super-free` is no longer a built-in Kilo model.
  `kilo/nemotron-3-super-free` and the bare `nemotron-3-super-free` remain a
  deprecated alias (`Kilo.DEPRECATED_ALIASES`) that runs on
  `kilo/nemotron-3-ultra-free` and logs a warning naming the replacement.
- The free-model drift check skips deprecated aliases and instead requires
  every alias target to be a built-in.
