// Proves: rg exits 2 when any path is unreadable even though matches exist;
// our grep.ts (L56-66) throws on any exit code other than 0/1, discarding the matches.
import fs from 'fs';
const RG = process.env.HOME + '/.local/share/link-assistant-agent/bin/rg';
const dir = '/tmp/issue-335-read-search/fx-exit2';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir + '/locked', { recursive: true });
fs.writeFileSync(dir + '/ok.txt', 'needle here\n');
fs.writeFileSync(dir + '/locked/secret.txt', 'needle\n');
fs.chmodSync(dir + '/locked', 0o000);
// --- copied from js/src/tool/grep.ts L41-66 ---
const args = ['--json', '--regexp', 'needle', dir];
const proc = Bun.spawn([RG, ...args], { stdout: 'pipe', stderr: 'pipe' });
const output = await new Response(proc.stdout).text();
const errorOutput = await new Response(proc.stderr).text();
const exitCode = await proc.exited;
const matchEvents = output
  .split('\n')
  .filter((l) => l.includes('"type":"match"')).length;
console.log({ exitCode, matchEvents, stderr: errorOutput.trim() });
try {
  if (exitCode === 1) console.log('No files found');
  else if (exitCode !== 0)
    throw new Error(`Exit code ${exitCode}\nripgrep failed: ${errorOutput}`);
  else console.log('OK');
} catch (e) {
  console.log('OUR GREP THROWS:', (e as Error).message.split('\n')[0]);
}
// upstream 4edb4fa4fa behaviour (with --no-messages):
const fixed =
  exitCode === 1 || (exitCode === 2 && !output.trim())
    ? 'empty'
    : exitCode !== 0 && exitCode !== 2
      ? 'throw'
      : 'parse matches (+ "Some paths were inaccessible")';
console.log('UPSTREAM:', fixed);
fs.chmodSync(dir + '/locked', 0o755);
