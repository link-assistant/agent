import { openAsBlob, constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { BlobReader, ZipReader } from '@zip.js/zip.js';

// Native adapter inventory: the SDK owns transfer/authentication/digests. Its
// documented raw-download option avoids the deprecated internal ZIP reader.
// zip.js owns ZIP/Zip64 parsing, CRC validation and streamed decompression.
export function entryTarget(root, filename) {
  const name = filename.replaceAll('\\', '/');
  // Check Windows names on every OS; a prefix test without a separator
  // would admit sibling paths. Refuse unsafe archives before writing files.
  if (
    name.includes('\0') ||
    path.posix.isAbsolute(name) ||
    path.win32.parse(name).root ||
    name.split('/').includes('..')
  ) {
    throw new Error('Unsafe artifact filename');
  }
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Unsafe artifact filename');
  }
  return target;
}

async function ensureDirectory(root, parent) {
  // Never follow a pre-existing link in the destination. Archive symlinks
  // are written as regular data files, as in the SDK's previous reader.
  let current = root;
  for (const component of path.relative(root, parent).split(path.sep)) {
    current = path.join(current, component);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    if (!(await lstat(current)).isDirectory()) {
      throw new Error('Artifact destination contains a link or non-directory');
    }
  }
}

export async function extractArchive(archive, directory) {
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  if (!(await lstat(root)).isDirectory()) {
    throw new Error('Artifact destination must be a directory without a link');
  }
  const zip = new ZipReader(new BlobReader(await openAsBlob(archive)), {
    useWebWorkers: false,
    checkCrc32: true,
  });
  try {
    for await (const entry of zip.getEntriesGenerator()) {
      const target = entryTarget(root, entry.filename);
      await ensureDirectory(
        root,
        entry.directory ? target : path.dirname(target)
      );
      if (!entry.directory) {
        try {
          if (!(await lstat(target)).isFile()) {
            throw new Error('Artifact destination file is not a regular file');
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
        const file = await open(
          target,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_TRUNC |
            constants.O_NOFOLLOW
        );
        try {
          await entry.getData(Writable.toWeb(file.createWriteStream()), {
            checkCrc32: true,
          });
        } finally {
          await file.close();
        }
      }
    }
  } finally {
    await zip.close();
  }
}

export async function downloadArtifactArchive(client, id, options) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'artifact-download-'));
  try {
    const result = await client.downloadArtifact(id, {
      ...options,
      path: temporary,
      skipDecompress: true,
    });
    const files = await readdir(temporary, { withFileTypes: true });
    if (files.length !== 1 || !files[0].isFile()) {
      throw new Error('Artifact download must contain exactly one archive');
    }
    if (result.digestMismatch) {
      throw new Error('Artifact download digest mismatch');
    }
    await extractArchive(path.join(temporary, files[0].name), options.path);
    return { ...result, downloadPath: options.path };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
