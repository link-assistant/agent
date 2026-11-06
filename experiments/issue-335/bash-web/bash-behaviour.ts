// Read-only experiment against the fork's BashTool. Run with:
//   bun experiments/issue-335/bash-web/bash-behaviour.ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { BashTool } = await import(`${SRC}/tool/bash`);
const { Instance } = await import(`${SRC}/project/instance`);

const directory = await mkdtemp(path.join(os.tmpdir(), 'expC-'));

async function run(command: string, timeout?: number) {
  let calls = 0;
  let bytes = 0;
  const res = await Instance.provide({
    directory,
    fn: async () => {
      const tool = await BashTool.init();
      return tool.execute(
        { command, timeout, description: 'exp' },
        {
          sessionID: 's',
          messageID: 'm',
          agent: 'build',
          abort: new AbortController().signal,
          metadata(v: any) {
            calls++;
            bytes += (v.metadata?.output ?? '').length;
          },
        }
      );
    },
  });
  return { res, calls, bytes };
}

// 1. Which shell runs the command? bash-isms on dash fail.
{
  const { res } = await run(
    'ps -o comm= -p $$; echo {1..3}; [[ 1 == 1 ]] && echo bashism-ok'
  );
  console.log('1. shell probe ->', JSON.stringify(res.output));
}

// 2. Truncation keeps the head, dropping the tail (where errors live).
{
  const { res } = await run(
    "printf output-start; head -c 100000 /dev/zero | tr '\\0' 'x'; printf FINAL-ERROR-LINE; exit 3"
  );
  console.log(
    '2. tail kept?',
    res.output.includes('FINAL-ERROR-LINE'),
    'head kept?',
    res.output.includes('output-start'),
    'len',
    res.output.length
  );
}

// 3. Metadata volume for a ~4 MB output.
{
  const before = process.memoryUsage().rss;
  const { res, calls, bytes } = await run(
    "head -c 4000000 /dev/zero | tr '\\0' 'x'"
  );
  console.log(
    '3. metadata calls',
    calls,
    'total metadata chars',
    bytes,
    'final metadata.output chars',
    res.metadata.output.length,
    'rss delta MB',
    ((process.memoryUsage().rss - before) / 1e6).toFixed(1)
  );
}

// 4. Timeout keeps partial output.
{
  const { res } = await run("printf 'before timeout'; sleep 5", 300);
  console.log('4. timeout ->', JSON.stringify(res.output), res.isError);
}

// 5. Killed by signal.
{
  const { res } = await run('kill -9 $$');
  console.log('5. signal ->', JSON.stringify(res.output), res.metadata.signal);
}

await Instance.disposeAll();
await rm(directory, { recursive: true, force: true });
