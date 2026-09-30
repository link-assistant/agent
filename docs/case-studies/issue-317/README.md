# Issue #317: process status must reach the model

The reported `gh issue view` command exited with status 4, but its authentication instructions were sent to an OpenAI-compatible model as ordinary tool text. The command's exit status existed only in UI metadata. See [issue #317](https://github.com/link-assistant/agent/issues/317) and the [original run](https://gist.github.com/konard/8a196a1d179ecb105304232a46e09ede).

## Reproduction

Run the bash tool with `false`, or with a command that prints `Please run gh auth login` and exits 4. Before the fix the JavaScript tool returned empty text for `false`, or only the authentication instructions for exit 4. The result was treated as successful by the session processor and by batch execution. The Rust implementation appended a status suffix but also treated returned command failures as successful batch calls.

The regression tests were run before implementation: seven JavaScript process tests, two local-provider tests, and four Rust assertions failed. The cancellation test also exposed a completion race: an already-aborted command could exit before the tool registered its completion listener.

## Result

- Failed commands prefix model-visible text with `Exit code N\n` and return `isError: true`. Success text is unchanged. Signal termination reports an unavailable exit status and the signal in JavaScript; timeout and cancellation include their reason.
- AI SDK tool results use `error-text`, which the Anthropic adapter translates to `is_error: true`. OpenAI-compatible providers receive the status in their tool-message text.
- Session history and stream-json record a failed tool state, retain the numeric `metadata.exit`, and preserve attachments from partially successful batches. The provider can continue the conversation after a failed command.
- Batch tools count returned failures correctly. The user shell runner and command-template shell substitutions use the same status formatting. Ripgrep execution errors include their exit code; its normal no-match exit status remains a successful empty search.
- Bash installs completion listeners before handling cancellation and waits for stdout/stderr to drain. Optional debug logging records the exit, signal, timeout, cancellation, and failure flag without recording the command or output.

## Automated verification

```sh
bun experiments/issue-322/verify-bash-parser.mjs

cd js
bun test ./tests/process-tool-status.ts ./tests/host-config-contract.ts ./tests/event-handler.js ./tests/json-standard-unit.js
npm run check
bun run test
npm audit --package-lock-only --audit-level=high

cd ../rust
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --locked --all-features
```

`process-tool-status.ts` covers quiet failure, exit 4, unchanged success, bounded output truncation, timeout, cancellation before and during execution, signal termination, SDK error conversion, an intercepted Anthropic request, batch accounting, history replay, and retained attachments. `host-config-contract.ts` uses a local OpenAI-compatible HTTP provider to inspect the next actual CLI request and both stream-json formats. These checks use no live model credentials.

The initial PR security audit also failed independently of this issue: `brace-expansion` in the committed npm lockfile had high-severity advisories. Refreshing the affected transitive versions clears the workflow's high-severity threshold. The existing low-severity Babel/OpenTUI advisory remains below that threshold; its suggested automatic fix would downgrade a direct dependency. No forced dependency downgrade was applied.

The dependency freshness run on September 30 also required newly published patches for the AI SDK packages, OpenTUI, and Hono. Both JavaScript lockfiles were refreshed for those patch releases, and the complete JavaScript suite was rerun. The documented compatibility pins for Solid and web-tree-sitter remain in place.

## Integration with the latest default branch

PR #326 landed overlapping dependency updates and a bash parser change after this fix was implemented. Resolve the lockfile conflicts with the newer default-branch resolutions, which include the required direct patches and patched brace-expansion and ip-address versions. Preserve the parser's support for both WASM filenames alongside the process-status fix, and keep its permission enforcement tests and packed-package CI check.

The branch also includes the subsequent 0.26.9 release commit. A separate process-status patch changeset records this fix without modifying the default branch's dependency release entry. The combined implementation passes 829 JavaScript tests (four existing todo), all 436 Rust tests, and four packed bash parser tests with each of web-tree-sitter 0.25.10 and 0.27.0.
