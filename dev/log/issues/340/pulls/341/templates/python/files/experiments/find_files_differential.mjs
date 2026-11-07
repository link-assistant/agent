// Compare findFiles() of two artifact-action copies on one fixture tree (issue #132).
// Usage: node experiments/find_files_differential.mjs <files.mjs> > out.json
// Run once against the @actions/glob implementation and once against the
// minimatch-11 walker, then diff the two outputs.
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { findFiles } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = await mkdtemp(path.join(tmpdir(), 'find-files-diff-'));
for (const name of ['a/one.txt', 'a/b/two.txt', 'a/b/skip.log', '.hidden.txt', 'a/.dot/x.txt', 'c/d/e/deep.bin', 'single.md', 'dir with space/f.txt']) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), name);
}
await symlink(path.join(root, 'a/one.txt'), path.join(root, 'link.txt'));
await symlink(path.join(root, 'c'), path.join(root, 'linkdir'));
const cases = [
  '.', 'a', 'a/', 'a/*', 'a/**', 'a/**/*.txt', '**/*.txt', 'single.md', 'missing',
  'a\n!a/b/skip.log', 'a\nc', '*/b', 'c/**/deep.bin', 'linkdir', 'link.txt', 'dir with space',
  '# comment\nsingle.md', 'a/b/*.{txt,log}', 'a/?/two.txt', 'a/[ab]/two.txt', '!a',
];
const results = {};
const cwd = process.cwd();
process.chdir(root);
for (const input of cases) {
  for (const form of ['relative', 'absolute']) {
    const value = form === 'relative' ? input : input.split('\n').map(line => (line.startsWith('#') || line.startsWith('!')) ? line[0] + (line[0] === '!' ? path.join(root, line.slice(1)) : line.slice(1)) : path.join(root, line)).join('\n');
    try {
      const { files, root: base } = await findFiles(value);
      results[`${form}:${JSON.stringify(input)}`] = { files: files.map(f => path.relative(root, f)), root: path.relative(root, base) || '.' };
    } catch (error) {
      results[`${form}:${JSON.stringify(input)}`] = { error: error.message.replace(root, '<root>') };
    }
  }
}
process.chdir(cwd);
await rm(root, { recursive: true, force: true });
console.log(JSON.stringify(results, null, 1));
