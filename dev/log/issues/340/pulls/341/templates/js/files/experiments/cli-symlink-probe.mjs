// Usage: node experiments/cli-symlink-probe.mjs
//        deno run -A experiments/cli-symlink-probe.mjs
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixture = mkdtempSync(join(tmpdir(), 'cli-symlink-probe-'));
try {
  const link = join(fixture, 'example-package-name');
  symlinkSync(resolve('bin/example-package-name.js'), link);
  const result = spawnSync(
    process.execPath,
    [
      ...(globalThis.Deno ? ['run', '-A', '--ext=js'] : []),
      link,
      'multiply',
      '6',
      '7',
    ],
    { encoding: 'utf8', timeout: 15000 }
  );
  console.log({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
