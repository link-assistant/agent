# Free model withdrawals (#327)

On October 12, 2026, the live Zen and Kilo catalogs confirmed the withdrawals reported in [issue #327](https://github.com/link-assistant/agent/issues/327). Zen's formerly suggested Ultra replacement had also disappeared. Kilo still served `nvidia/nemotron-3-super-120b-a12b:free`, Ultra, and Lightning. The JSON snapshots here preserve the relevant free rows and their published capabilities, not the entire paid catalog.

The runtime was using stale models.dev data and hardcoded gateway IDs. It selected withdrawn MiniMax for both the main model and secondary requests. Zen's typed HTTP 403 client restriction could also inherit retryability from SDK errors.

## Reproduce and verify

From `js/`, after `bun install --frozen-lockfile`:

```bash
bun ../experiments/issue-327/inspect-models.ts
bun test ./tests/free-model-catalog.ts ./tests/free-model-requests.ts ./tests/model-drift.ts
npm run check:model-drift
```

`inspect-models.ts` supplies deliberately stale models.dev metadata and prints the resolved runtime models without contacting an inference endpoint. The six original regression tests in `free-model-catalog.ts` failed before the fix (0 pass, 6 fail): default/cascade, exact Kilo ID and short-name routing, withdrawn Kilo IDs, withdrawn Zen IDs, auxiliary model choice, and retryable `FreeTierError`.

`mock-turn.ts` runs the actual CLI and SDK against a local HTTP server. It accepts only the exact served Super ID, exercises streaming inference and the session title, and verifies that a Zen `FreeTierError` causes one request and a nonzero exit. It bounds each child to 30 seconds and closes the server after the process exits. No credentials or paid inference are needed.

The drift tests simulate missing IDs, malformed catalogs, HTTP errors, and invalid JSON. The live check separately verifies today's advertised availability for the three maintained Kilo IDs and two maintained Zen IDs. Catalog membership does not prove successful inference, pricing, or client access.

The existing `tests/integration/verbose-hi.js` smoke test also passed against live Kilo on October 12: the completion returned HTTP 200, produced a greeting, and reported `nvidia/nemotron-3-super-120b-a12b:free` as both requested and responded model. This environment had no Kilo API key or stored auth, so anonymous inference happened to work at the time of the check; use authentication for reliable gateway access. The issue comment separately contains an authenticated downstream smoke test for the same Super ID.
