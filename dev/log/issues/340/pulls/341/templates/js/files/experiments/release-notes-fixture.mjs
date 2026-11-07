// Offline dependency seam for exercising the real release formatter and gh CLI.
import { spawnSync } from 'node:child_process';
globalThis.releaseFixtureModule = (name) => {
  if (name === 'lino-arguments') {
    return {
      makeConfig: () => ({
        releaseId: '1',
        releaseVersion: 'v1.2.3',
        repository: 'owner/repo',
        commitSha: 'fallback',
        jsRoot: '.',
      }),
    };
  }
  if (name === 'command-stream') {
    return {
      $: (strings, ...values) => ({
        run: (options = {}) => {
          const command = strings.reduce(
            (text, part, index) => text + part + (values[index] ?? ''),
            ''
          );
          const result = spawnSync('bash', ['-e', '-c', command], {
            encoding: 'utf8',
            input: options.stdin,
          });
          if (result.status !== 0) {
            throw new Error(`Fixture command failed: ${result.stderr}`);
          }
          return Promise.resolve(result);
        },
      }),
      shell: { errexit: () => {} },
    };
  }
  throw new Error(`Unexpected fixture dependency: ${name}`);
};
// Intercept local imports only in this fixture process. Production has no
// environment/global override for dependency resolution.
const { registerHooks } = await import('node:module');
registerHooks({
  resolve(specifier, context, nextResolve) {
    const name = specifier;
    if (['command-stream', 'lino-arguments'].includes(name)) {
      const source =
        name === 'command-stream'
          ? "export const { $, shell } = globalThis.releaseFixtureModule('command-stream');"
          : "export const { makeConfig } = globalThis.releaseFixtureModule('lino-arguments');";
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
