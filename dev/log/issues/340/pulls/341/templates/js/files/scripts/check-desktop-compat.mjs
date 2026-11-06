// Test the installed desktop consumers, including their CommonJS/ESM boundary.
import assert from 'node:assert/strict';
import { close, createReadStream } from 'node:fs';
import { access, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(
  new URL('../examples/universal-app/package.json', import.meta.url)
);
const { AsarPackager } = require('app-builder-lib/out/asar/asarUtil.js');
const {
  checkFileInArchive,
} = require('app-builder-lib/out/asar/asarFileChecker.js');
const asar = require('@electron/asar');
const temp = require('temp').track();
const { createTempDir } = require('electron-winstaller/lib/temp-utils.js');
// electron-winstaller loads asar through require(), then extracts package.json.
require('electron-winstaller');
const root = await mkdtemp(join(tmpdir(), 'desktop-compat-'));
try {
  const source = join(root, 'source');
  await mkdir(join(source, 'nested'), { recursive: true });
  const fixtures = new Map([
    ['package.json', Buffer.from('{"name":"desktop-compat-fixture"}')],
    ['nested/bytes.bin', Buffer.from([0, 255, 13, 10, 128])],
  ]);
  const streams = [];
  for (const [name, bytes] of fixtures) {
    const file = join(source, name);
    await writeFile(file, bytes);
    streams.push({
      path: name,
      type: 'file',
      stat: await stat(file),
      unpacked: name.endsWith('.bin'),
      streamGenerator: () => createReadStream(file),
    });
  }
  const packager = new AsarPackager({}, { resourcePath: root });
  await packager.executeElectronAsar(streams);
  for (const [name, bytes] of fixtures) {
    assert.deepEqual(asar.extractFile(packager.outFile, name), bytes);
    const metadata = await checkFileInArchive(
      packager.outFile,
      name,
      'fixture'
    );
    assert.equal(metadata.size, bytes.length);
  }
  await assert.rejects(
    checkFileInArchive(packager.outFile, 'missing', 'fixture'),
    /does not exist|corrupted/
  );
  const asyncDirectory = await createTempDir({ dir: root, prefix: 'async-' });
  await writeFile(join(asyncDirectory, 'file'), 'temporary');
  const file = await temp.open({ dir: root });
  await promisify(close)(file.fd);
  assert.deepEqual(await temp.cleanup(), { files: 1, dirs: 1 });
  await assert.rejects(access(asyncDirectory), { code: 'ENOENT' });
  await assert.rejects(access(file.path), { code: 'ENOENT' });
  const syncDirectory = temp.mkdirSync({ dir: root, prefix: 'sync-' });
  await writeFile(join(syncDirectory, 'file'), 'temporary');
  assert.deepEqual(temp.cleanupSync(), { files: 0, dirs: 1 });
  await assert.rejects(access(syncDirectory), { code: 'ENOENT' });
  console.log(
    'Desktop consumers: ASAR packed/unpacked bytes and temp cleanup passed.'
  );
} finally {
  asar.uncacheAll();
  await rm(root, { recursive: true, force: true });
}
