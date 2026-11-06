---
bump: patch
---

### Fixed

- The default model and default compaction model are now
  `kilo/nemotron-3-ultra-free`, and the default compaction cascade is
  `(kilo/nemotron-3-ultra-free kilo/nemotron-3.5-lightning-free same)`,
  because Kilo withdrew the former default `kilo/nemotron-3-super-free`
  (`nvidia/nemotron-3-super-120b-a12b:free`) (#335).
