The CI audit in https://github.com/link-assistant/agent/pull/341 reproduced a false success in `scripts/install-git-hooks.mjs` at template commit a495fc162164d615063251d620fcdf51d5a1068b.

Husky reports some installation failures as returned text rather than exceptions. The helper reads that text, but accepts any existing `core.hooksPath` as proof of success. A previous configuration can remain after a failed install.

Finite reproduction using the helper's existing injection points (no package install needed):

```js
import { installGitHooks } from './scripts/install-git-hooks.mjs';
const status = await installGitHooks({
  env: {},
  exists: () => true,
  install: async () => 'installation failed',
  readHooksPath: () => '.husky/_',
  log: () => {},
});
console.log(status); // actual 0, expected 1
```

This makes prepare green while no hook was installed. Agent previously had the broader `husky || true` masking problem; its fix now rejects both nonempty failure messages and absent configuration, with mocked regression tests.

Workaround: remove stale `core.hooksPath` before diagnosing hook setup, then verify the installed hook files. Suggested code fix: change `if (!hooksPath)` to `if (message || !hooksPath)` and add a regression case with an installation error plus an existing hooks path. Keep explicit CI/HUSKY=0 skips passing, and verify that a normal empty result with valid configuration still succeeds.
