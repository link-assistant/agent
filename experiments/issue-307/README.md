# Issue #307 — secondary calls ignore `--model`

Two scripts reproducing the reported behaviour and checking the fix. Run them from the `js` directory.

## Which model do the secondary calls use?

`print-secondary-models.ts` resolves a run's compaction config — the model used for compaction _and_ for the session summary — for a given `--model` selector.

```bash
cd js
FORMAL_AI_API_KEY=local-test-token LINK_ASSISTANT_AGENT_CONFIG_CONTENT='{}' \
  bun run ../experiments/issue-307/print-secondary-models.ts formalai/formal-ai
```

Before the fix, a Formal AI run sent its summaries to OpenCode:

```json
{
  "base": "formalai/formal-ai",
  "compactionPrimary": "opencode/big-pickle",
  "useSameModel": false,
  "cascade": [
    "opencode/big-pickle",
    "kilo/minimax-m2.5-free",
    "same(formalai/formal-ai)"
  ]
}
```

After the fix the built-in cascade follows `--model`:

```json
{
  "base": "formalai/formal-ai",
  "compactionPrimary": "formalai/formal-ai",
  "useSameModel": true,
  "cascade": ["same(formalai/formal-ai)"]
}
```

A run on the built-in provider (`opencode/big-pickle`) keeps the full cascade — those entries are the rate-limit fallbacks it was written for.

## A model with no context limit

`unlimited-context.ts` prints how a provider model override is understood, and whether such a model can overflow.

```bash
cd js
FORMAL_AI_API_KEY=t \
LINK_ASSISTANT_AGENT_CONFIG_CONTENT='{"provider":{"formalai":{"models":{"formal-ai":{"limit":{"context":null}}}}}}' \
  bun run ../experiments/issue-307/unlimited-context.ts
```

```json
{
  "limit": { "context": 0, "output": 8192 },
  "unlimited": true,
  "hasUnlimited": true,
  "overflow": false,
  "diagnostics": null
}
```

Without the override the same model reports its 60K window and overflows on 10M tokens. `{"unlimited":true}` is the equivalent spelling.
