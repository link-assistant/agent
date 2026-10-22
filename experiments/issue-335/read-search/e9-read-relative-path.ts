// read.ts L39-41 joins relative paths with Instance.worktree; glob.ts L21-23 / upstream 6cf2c3e3db use Instance.directory.
// Case 1: this repo, agent started in js/ (directory) inside git root (worktree).
import path from 'path';
const worktree = '/repo',
  directory = '/repo/js';
for (const [w, d] of [
  [worktree, directory],
  ['/', '/home/box/notes'],
]) {
  const ours = path.join(w, 'src/tool/read.ts');
  const fixed = path.resolve(d, 'src/tool/read.ts');
  console.log(
    `worktree=${w} directory=${d}\n  ours  -> ${ours} exists=${await Bun.file(ours).exists()}\n  fixed -> ${fixed}${d === directory ? ' exists=' + (await Bun.file(fixed).exists()) : ''}`
  );
}
