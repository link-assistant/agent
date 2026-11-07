### Fixed

- Pin all Ubuntu CI jobs and matrix values to Ubuntu 24.04 so generated
  repositories avoid an unreviewed operating system migration.
- Retry link-check transport errors, HTTP 429 and 5xx responses with bounded
  backoff, and verify throttled GitHub blob/tree pages through the Contents
  API. Keep final failures visible even when other links recover.
