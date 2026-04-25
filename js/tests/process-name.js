import { test, expect, describe } from 'bun:test';
import { $ } from 'bun';
import { platform } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

describe('Process name identification', () => {
  // On Linux, prctl(PR_SET_NAME) changes /proc/<pid>/comm which is what top/ps show.
  // On macOS, there is no userspace API to change the process comm; when installed
  // via `bun install -g`, the symlink is named 'agent' so macOS shows it correctly.
  // On Windows, Task Manager shows the executable name.
  test('setProcessName sets comm to "agent" via prctl on Linux', async () => {
    const os = platform();
    if (os !== 'linux') {
      console.log(`Skipping: prctl is Linux-only (current: ${os})`);
      return;
    }

    // Run a script that imports setProcessName and reports the comm name
    const script = `
      import { setProcessName } from '${join(srcDir, 'cli', 'process-name.ts').replace(/\\/g, '/')}';
      import { readFileSync } from 'fs';

      setProcessName('agent');

      const comm = readFileSync('/proc/' + process.pid + '/comm', 'utf8').trim();
      process.stdout.write(comm);
    `;

    const result = await $`bun -e ${script}`.quiet().nothrow();
    const processName = result.stdout.toString().trim();

    console.log(`Platform: ${os}`);
    console.log(`Process comm name: "${processName}"`);

    expect(processName).toBe('agent');
  });

  test('agent CLI process appears as "agent" in ps on Linux', async () => {
    const os = platform();
    if (os !== 'linux') {
      console.log(`Skipping: prctl is Linux-only (current: ${os})`);
      return;
    }

    // Run a script that imports setProcessName, verifies both /proc/comm and ps output
    const script = `
      import { readFileSync } from 'fs';
      import { execSync } from 'child_process';
      import { setProcessName } from '${join(srcDir, 'cli', 'process-name.ts').replace(/\\/g, '/')}';

      setProcessName('agent');

      const comm = readFileSync('/proc/' + process.pid + '/comm', 'utf8').trim();
      const psOutput = execSync('ps -p ' + process.pid + ' -o comm=').toString().trim();

      process.stdout.write(JSON.stringify({ comm, psComm: psOutput }));
    `;

    const result = await $`bun -e ${script}`.quiet().nothrow();
    const output = JSON.parse(result.stdout.toString().trim());

    console.log(`Process comm: "${output.comm}"`);
    console.log(`ps comm: "${output.psComm}"`);

    expect(output.comm).toBe('agent');
    expect(output.psComm).toBe('agent');
  });
});
