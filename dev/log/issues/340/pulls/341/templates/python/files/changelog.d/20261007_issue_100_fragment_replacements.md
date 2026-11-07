### Fixed

- Count newly added changelog fragments that replace similar pending fragments
  by detecting only byte-identical renames, while continuing to reject unchanged
  moves as new fragments.
