process.env.RIPGREP_CONFIG_PATH = '/tmp/rsr/rc';
const p = Bun.spawn(
  [
    process.env.HOME + '/.local/share/link-assistant-agent/bin/rg',
    '--files',
    '--glob=*.txt',
  ],
  { cwd: '/tmp/rsr/cfg', stdout: 'pipe' }
);
console.log(
  JSON.stringify(await new Response(p.stdout).text()),
  await p.exited
);
