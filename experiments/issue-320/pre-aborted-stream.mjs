// command-stream 1.3.0: stream() never ends when the AbortSignal passed in
// options is already aborted. setupExternalAbortSignal() kills and finishes the
// runner synchronously inside _startAsync(), before stream() subscribes to the
// 'end' and 'exit' events, so the iterator waits forever.
// Run: node experiments/issue-320/pre-aborted-stream.mjs (or bun)
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { $ } = require('command-stream');

const started = Date.now();
const watchdog = setTimeout(() => {
  console.log(`BUG: stream() still pending after ${Date.now() - started} ms`);
  process.exit(1);
}, 2000);

const command = $({ signal: AbortSignal.abort(), mirror: false })`sleep 5`;
for await (const chunk of command.stream()) {
  console.log('chunk', chunk.type);
}
clearTimeout(watchdog);
console.log(`OK: stream() ended after ${Date.now() - started} ms`);
