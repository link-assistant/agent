import { stat, open, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function gnuTar() {
  if (process.platform === 'darwin') {
    return 'gtar';
  }
  if (process.platform === 'win32') {
    // Windows' System32 tar is BSD tar. Use the GNU tar shipped with Git Bash.
    const gitExec = execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
    }).trim();
    return path.resolve(gitExec, '../../..', 'usr/bin/tar.exe');
  }
  return 'tar';
}

/** Require regular file contents, including file symlinks. Preserve glob layout. */
export async function collectArtifactFiles(search, input, requiredFile = '') {
  if (requiredFile) {
    const handle = await open(requiredFile, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size === 0) {
        throw new Error(`Required artifact file is empty: ${requiredFile}`);
      }
    } finally {
      await handle.close();
    }
  }
  const files = [];
  for (const file of await search.glob()) {
    if ((await stat(file)).isFile()) {
      files.push(file);
    }
  }
  if (!files.length) {
    throw new Error(`Required artifact evidence is missing or empty: ${input}`);
  }
  let root = path.dirname(files[0]);
  for (const file of [...files, ...search.getSearchPaths()]) {
    while (path.relative(root, file).split(path.sep)[0] === '..') {
      root = path.dirname(root);
    }
    if (path.isAbsolute(path.relative(root, file))) {
      throw new Error('Artifact paths must be on the same volume');
    }
  }
  return { files, root };
}

/** Match upload-pages-artifact: one artifact.tar, dereferenced and uncompressed. */
export async function packagePages(input) {
  const root = await mkdtemp(path.join(tmpdir(), 'pages-artifact-'));
  const archive = path.join(root, 'artifact.tar');
  try {
    execFileSync(gnuTar(), [
      '--dereference',
      '--hard-dereference',
      '--directory',
      path.resolve(input),
      '-cf',
      archive,
      '--exclude=.git',
      '--exclude=.github',
      '--exclude=.[^/]*',
      ...(process.platform === 'win32' ? ['--force-local'] : []),
      '.',
    ]);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { files: [archive], root };
}
