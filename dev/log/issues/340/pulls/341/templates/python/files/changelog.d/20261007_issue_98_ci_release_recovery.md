### Fixed

- Apply the Git checkout branch configuration to every workflow and prevent
  workflow output values from being interpolated into shell code.
- Resume partial PyPI/GitHub releases with artifact checks, duplicate-upload
  handling and a bounded ten-minute PyPI visibility wait in both package layouts.
- Preserve existing GitHub releases during recovery and publish existing drafts.
- Add the Lychee ignore template and throttle GitHub link checks before retries.

### Security

- Audit low-confidence workflow findings with one pinned zizmor version and
  pin matching secretlint CLI/preset versions.
- Exclude root and Python-layout experiment directories from CodeQL analysis.
