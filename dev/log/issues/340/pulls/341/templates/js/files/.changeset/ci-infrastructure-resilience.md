---
'@link-foundation/example-package-name': patch
---

Make CI survive GitHub infrastructure failures:

- Retry transient failures to create a Pages deployment, without deploying one commit twice.
- Recheck links weekly, and scope the lychee cache to the UTC day.
- Report every npm advisory, and fail the weekly run on fixable moderate ones.
- Pin the artifact SDK's glob past GHSA-3g3m-2fjr-6pw4.
- Name jobs that never got a hosted runner in every status gate, and rerun such runs automatically, at most twice.
