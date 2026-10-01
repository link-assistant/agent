// Forces the Windows branch of the bash tool on any platform to check that a
// cancelled command still settles once the taskkill step completes. On a
// non-Windows host taskkill is missing, so only the control flow is checked.
// Run from js/: bun ../experiments/issue-320/windows-stop-flow.ts
Object.defineProperty(process, 'platform', { value: 'win32' });
const { BashTool } = await import('../../js/src/tool/bash');
const { Instance } = await import('../../js/src/project/instance');

const controller = new AbortController();
setTimeout(() => controller.abort(), 200);
const started = Date.now();
const result = await Instance.provide({
  directory: process.cwd(),
  fn: async () =>
    (await BashTool.init()).execute(
      { command: 'sleep 5', description: 'sleep' },
      {
        sessionID: 'ses_x',
        messageID: 'msg_x',
        agent: 'agent',
        abort: controller.signal,
        metadata() {},
      } as any
    ),
});
console.log(JSON.stringify(result.output), Date.now() - started, 'ms');
process.exit(0);
