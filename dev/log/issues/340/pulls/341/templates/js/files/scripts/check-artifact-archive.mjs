// Exercise the actual SDK archive dependencies; mocks cannot prove overrides
// preserve ZIP contents. Run with node --throw-deprecation after
// `npm ci --prefix .github/actions/artifact-transport --ignore-scripts`.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import {
  downloadArtifactArchive,
  entryTarget,
  extractArchive,
} from '../.github/actions/artifact-transport/extract.mjs';

const require = createRequire(
  new URL('../.github/actions/artifact-transport/package.json', import.meta.url)
);
const sdkRequire = createRequire(
  new URL(
    '../.github/actions/artifact-transport/node_modules/@actions/artifact/package.json',
    import.meta.url
  )
);
const archiver = sdkRequire('archiver');
const { file } = require('archiver-utils');
const root = await mkdtemp(join(tmpdir(), 'artifact-sdk-smoke-'));
try {
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  await mkdir(join(source, 'nested'), { recursive: true });
  const fixtures = new Map([
    ['nested/bytes.bin', Buffer.from([0, 255, 13, 10, 128])],
    ['empty.txt', Buffer.alloc(0)],
    ['report.txt', Buffer.from('complete evidence\n')],
    ['..notes', Buffer.from('ordinary dot-prefixed name')],
    ['nested/данные.txt', Buffer.from('Unicode filenames')],
  ]);
  for (const [name, bytes] of fixtures) {
    await writeFile(join(source, name), bytes);
  }
  assert.deepEqual(
    file.expand({ cwd: source, nodir: true }, ['**/*', '!report.txt']).sort(),
    ['empty.txt', 'nested/bytes.bin', 'nested/данные.txt']
  );
  const archivePath = join(root, 'evidence.zip');
  const output = createWriteStream(archivePath);
  const closed = once(output, 'close');
  const archive = archiver('zip', { forceZip64: true });
  archive.on('error', (error) => output.destroy(error));
  archive.pipe(output);
  archive.directory(source, false);
  archive.append('', { name: 'empty-directory/' });
  // ZIP names are outside the content CRC. Replace equal-length names after
  // writing so archiver's own sanitization cannot mask reader defects.
  const escapeNames = [
    '../destination2/escape.txt',
    '..\\destination2\\escape.txt',
  ];
  for (const [index, name] of escapeNames.entries()) {
    archive.append('must remain inside the archive', {
      name: String(index).repeat(name.length),
    });
  }
  await archive.finalize();
  await closed;
  const bytes = await readFile(archivePath);
  assert.notEqual(bytes.indexOf(Buffer.from('504b0606', 'hex')), -1);
  const corrupt = Buffer.from(bytes);
  const centralDirectory = corrupt.indexOf(Buffer.from('504b0102', 'hex'));
  const reportName = corrupt.indexOf(
    Buffer.from('report.txt'),
    centralDirectory
  );
  const centralCrc = reportName - 46 + 16;
  assert.equal(corrupt.readUInt32LE(centralCrc - 16), 0x02014b50);
  corrupt.writeUInt32LE(
    (corrupt.readUInt32LE(centralCrc) + 1) >>> 0,
    centralCrc
  );
  const corruptPath = join(root, 'corrupt.zip');
  await writeFile(corruptPath, corrupt);
  await assert.rejects(
    extractArchive(corruptPath, join(root, 'corrupt')),
    /CRC|Signature|Invalid/i
  );
  for (const [index, name] of escapeNames.entries()) {
    const traversalBytes = Buffer.from(bytes);
    const placeholder = Buffer.from(String(index).repeat(name.length));
    let replacements = 0;
    for (
      let offset = traversalBytes.indexOf(placeholder);
      offset !== -1;
      offset = traversalBytes.indexOf(placeholder, offset + placeholder.length)
    ) {
      traversalBytes.write(name, offset, 'utf8');
      replacements++;
    }
    assert.equal(replacements, 2, 'replace both local and central ZIP headers');
    const traversalPath = join(root, `traversal-${index}.zip`);
    await writeFile(traversalPath, traversalBytes);
    await assert.rejects(
      extractArchive(traversalPath, join(root, 'malicious')),
      /Unsafe filename/
    );
  }
  // zip.js refuses the traversal names above first; exercise the adapter's
  // own independent guard directly so it cannot regress unnoticed.
  for (const name of [
    '../escape',
    'a/../../escape',
    '..\\escape',
    '/abs',
    'C:/abs',
    'C:\\abs',
    '\\\\server\\share\\file',
    'nul\0byte',
    '.',
  ]) {
    assert.throws(() => entryTarget(destination, name), /Unsafe artifact/);
  }
  assert.equal(
    entryTarget(destination, 'nested\\file'),
    join(destination, 'nested', 'file')
  );
  assert.equal(
    entryTarget(destination, '..notes'),
    join(destination, '..notes')
  );
  let downloaded;
  const result = await downloadArtifactArchive(
    {
      async downloadArtifact(id, options) {
        assert.equal(id, 42);
        assert.equal(options.skipDecompress, true);
        downloaded = options.path;
        await copyFile(archivePath, join(downloaded, 'artifact.zip'));
        return { digestMismatch: false };
      },
    },
    42,
    { path: destination }
  );
  assert.equal(result.downloadPath, destination);
  await assert.rejects(access(downloaded), { code: 'ENOENT' });
  for (const [name, bytes] of fixtures) {
    assert.deepEqual(await readFile(join(destination, name)), bytes);
  }
  await access(join(destination, 'empty-directory'));
  await assert.rejects(readFile(join(root, 'destination2/escape.txt')), {
    code: 'ENOENT',
  });
  for (const mode of [
    'empty',
    'multiple',
    'digest mismatch',
    'corrupt',
    'transport',
  ]) {
    await assert.rejects(
      downloadArtifactArchive(
        {
          async downloadArtifact(id, { path }) {
            downloaded = path;
            if (mode === 'transport') {
              throw new Error('transport ECONNRESET');
            }
            if (mode !== 'empty') {
              await writeFile(join(path, 'artifact.zip'), 'invalid ZIP');
            }
            if (mode === 'multiple') {
              await writeFile(join(path, 'unexpected'), 'not an archive');
            }
            return { digestMismatch: mode === 'digest mismatch' };
          },
        },
        42,
        { path: destination }
      ),
      mode === 'corrupt'
        ? /File format is not recognized/
        : /archive|digest|transport/
    );
    await assert.rejects(access(downloaded), { code: 'ENOENT' });
  }
  const linkDestination = join(root, 'linked');
  await mkdir(linkDestination);
  await symlink(source, join(linkDestination, 'nested'), 'junction');
  await assert.rejects(
    extractArchive(archivePath, linkDestination),
    /link|non-directory/
  );
  await rm(join(linkDestination, 'nested'));
  await rm(join(linkDestination, 'empty.txt'));
  await symlink(join(source, 'empty.txt'), join(linkDestination, 'empty.txt'));
  await assert.rejects(
    extractArchive(archivePath, linkDestination),
    /regular file/
  );
  console.log(
    'Artifact SDK archive roundtrip: binary, empty and nested files preserved.'
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
