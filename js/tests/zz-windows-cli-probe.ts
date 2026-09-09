/**
 * TEMPORARY diagnostic probe for the Windows-only stall of the CLI turn
 * (surfaced by tests/session-summary-failure.ts, issue #304). Always passes; it
 * only prints how far startup gets on each platform. Delete once the root cause
 * is known.
 *
 * Round 1 established: on windows-latest the CLI exits 0 within ~60ms of the
 * first config "loading" log, with a cooperative provider and zero requests
 * made — i.e. a promise inside startup never settles, the loop drains and Bun
 * exits. This round bisects which startup await never settles.
 */
import { describe, expect, test, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(60000);

const script = `
  import path from 'path';

  const t0 = Date.now();
  let last = 'start';
  const mark = (step) => {
    last = step;
    console.log('PD step=' + step + ' t=' + (Date.now() - t0));
  };
  process.on('exit', (code) => {
    console.log('PD exit code=' + code + ' lastStep=' + last + ' t=' + (Date.now() - t0));
  });
  const settle = (promise) => promise.then((v) => 'ok:' + String(v).slice(0, 40), (e) => 'err:' + (e && (e.code || e.name || e.message)));

  mark('import-global');
  const { Global } = await import('./src/global/index.ts');
  mark('global-imported:' + Global.Path.config);

  mark('bun-file-text');
  mark('bun-file-text-done:' + await settle(Bun.file(path.join(Global.Path.config, 'config.json')).text()));

  mark('dynamic-import-toml');
  mark('dynamic-import-toml-done:' + await settle(import(path.join(Global.Path.config, 'config'), { with: { type: 'toml' } })));

  mark('auth-all');
  const { Auth } = await import('./src/auth/index.ts');
  mark('auth-all-done:' + await settle(Auth.all().then((v) => Object.keys(v).length)));

  mark('config-global');
  const { Config } = await import('./src/config/file-config.ts');
  mark('config-global-done:' + await settle(Config.global().then(() => 'loaded')));

  mark('instance-provide');
  const { Instance } = await import('./src/project/instance.ts');
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      mark('config-get');
      mark('config-get-done:' + await settle(Config.get().then(() => 'loaded')));
      mark('models-get');
      const { ModelsDev } = await import('./src/provider/models.ts');
      mark('models-get-done:' + await settle(ModelsDev.get().then((db) => Object.keys(db).length + ' providers')));
      mark('provider-state');
      const { Provider } = await import('./src/provider/provider.ts');
      mark('provider-state-done:' + await settle(Provider.state().then(() => 'ready')));
    },
  });
  mark('finished');
  await Instance.disposeAll();
`;

describe('windows CLI startup probe (temporary, #304)', () => {
  test('bisects the startup await that never settles', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', '--eval', script],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    console.log(
      `PROBE_D platform=${process.platform} exit=${exitCode}\nstdout:\n${stdout}\nstderr tail:\n${stderr.slice(
        -3000
      )}\nPROBE_D_END`
    );
    expect(true).toBe(true);
  });
});
