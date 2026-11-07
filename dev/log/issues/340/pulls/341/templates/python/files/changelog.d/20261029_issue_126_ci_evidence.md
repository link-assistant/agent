### Fixed

- Retry transient artifact transfers without repeating validated tests, reconcile
  ambiguous uploads, and preserve failures for permanent refusals or missing
  evidence, including GitHub Pages and diagnostic reports.
- Avoid deprecated artifact ZIP extraction while enforcing SHA256 verification
  and validating paths and symlinks before extracting with Python's zipfile.
- Run full CodeQL analysis for large pull requests and fail the Security gate on
  findings or incomplete SARIF reports while preserving scan evidence.
- Detect existing release badges by parsed URL host so unrelated URLs and prose
  cannot suppress the PyPI badge; resolve findings exposed by the full scan.
- Reject missing, unreadable, empty or malformed lychee reports after a failed
  checker instead of reporting that all broken links have archived versions.
- Preserve fenced changelog examples and following release details, and refuse
  publication when the requested changelog entry is missing or empty.
