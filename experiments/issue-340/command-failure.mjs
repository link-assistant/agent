// Finite, network-free reproduction of release commands reporting false success.
import * as commands from '../../js/node_modules/command-stream/src/$.mjs';
import { useModule } from '../../scripts/use-module.mjs';
import { pushWithRebaseRetry } from '../../scripts/push-with-rebase-retry.mjs';

const mode = process.argv[2] ?? 'after';
// Production loading must succeed without a CDN or any network fallback.
globalThis.fetch = () =>
  Promise.reject(new Error('Network disabled by regression'));
const { $ } = mode === 'before' ? commands : await useModule('command-stream');
const failure = 'process.stderr.write("fetch first\\n"); process.exit(7)';
if (mode === 'retry') {
  let pushes = 0;
  let rebases = 0;
  await pushWithRebaseRetry({
    push: () => {
      pushes++;
      const code = pushes === 1 ? failure : 'process.exit(0)';
      return $`${process.execPath} -e ${code}`.run({ mirror: false });
    },
    pullRebase: () => {
      rebases++;
      return Promise.resolve();
    },
    log: () => {},
  });
  console.log(JSON.stringify({ pushes, rebases }));
} else {
  try {
    const result = await $`${process.execPath} -e ${failure}`.run({
      mirror: false,
    });
    console.log(JSON.stringify({ falselySucceeded: true, code: result.code }));
  } catch (error) {
    console.log(
      JSON.stringify({ rejected: true, code: error.code, stderr: error.stderr })
    );
    process.exitCode = error.code;
  }
}
