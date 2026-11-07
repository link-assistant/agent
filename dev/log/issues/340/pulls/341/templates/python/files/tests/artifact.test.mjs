import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { isTransient, uploadWithRetry, downloadWithRetry } from '../.github/actions/artifact/transport.mjs';
import { findFiles, packagePages } from '../.github/actions/artifact/files.mjs';

const network = (code = 'ENOTFOUND') => Object.assign(new Error(`Unable to make request: ${code}`), { code });
const notFound = () => Object.assign(new Error('not found'), { name: 'ArtifactNotFoundError' });
const noWait = { sleep: async () => {}, log: () => {} };

for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'EPIPE']) {
  test(`recovers ${code} without rerunning the producer`, async () => {
    let uploads = 0;
    let deletes = 0;
    const client = {
      getArtifact: async () => { throw notFound(); },
      deleteArtifact: async () => { deletes++; throw notFound(); },
      uploadArtifact: async () => { if (++uploads === 1) throw network(code); return { id: 42 }; },
    };
    const result = await uploadWithRetry(client, 'evidence', ['file'], '/root', {}, noWait);
    assert.equal(result.id, 42);
    assert.equal(uploads, 2);
    assert.equal(deletes, 1);
  });
}

test('replaces only its own artifact after a lost finalize response', async () => {
  let finalized = false;
  let uploads = 0;
  const client = {
    getArtifact: async () => { throw notFound(); },
    deleteArtifact: async () => { assert.equal(finalized, true); finalized = false; },
    uploadArtifact: async () => {
      assert.equal(finalized, false, 'duplicate-name conflict');
      finalized = true;
      if (++uploads === 1) throw network('ECONNRESET');
      return { id: 43 };
    },
  };
  assert.equal((await uploadWithRetry(client, 'site', ['file'], '/root', {}, noWait)).id, 43);
});

test('never replaces a preexisting artifact', async () => {
  const client = { getArtifact: async () => ({ artifact: { id: 99 } }) };
  await assert.rejects(uploadWithRetry(client, 'stale', ['file'], '/root', {}, noWait), /already exists/);
});

test('transport exhaustion fails after exactly three uploads', async () => {
  let calls = 0;
  const client = {
    getArtifact: async () => { throw notFound(); },
    deleteArtifact: async () => { throw notFound(); },
    uploadArtifact: async () => { calls++; throw network(); },
  };
  await assert.rejects(uploadWithRetry(client, 'site', ['file'], '/root', {}, noWait), /ENOTFOUND/);
  assert.equal(calls, 3);
});

for (const error of [Object.assign(network(), { status: 403 }), new Error('Artifact storage quota has been hit'), new Error('Failed to CreateArtifact: 409 Conflict'), new Error('401 Unauthorized'), new Error('No files were found')]) {
  test(`permanent refusal is immediate: ${error.message}`, async () => {
    assert.equal(isTransient(error), false);
    let calls = 0;
    const client = {
      getArtifact: async () => { throw notFound(); },
      uploadArtifact: async () => { calls++; throw error; },
    };
    await assert.rejects(uploadWithRetry(client, 'site', ['file'], '/root', {}, noWait));
    assert.equal(calls, 1);
  });
}

test('nested transport errors retry but permanent statuses dominate', () => {
  assert.equal(isTransient(new Error('wrapper', { cause: network() })), true);
  assert.equal(isTransient(Object.assign(new Error('503 unavailable'), { status: 503 })), true);
  assert.equal(isTransient(Object.assign(new Error('429 rate limited'), { status: 429 })), true);
  assert.equal(isTransient(new Error('wrapper', { cause: Object.assign(network(), { status: 401 }) })), false);
});

test('empty and missing evidence fails before network access; globs preserve root', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'artifact-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(findFiles(root), /empty|No files/);
  await assert.rejects(findFiles(path.join(root, 'missing')), /empty|No files/);
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'bytes.bin'), Buffer.from([0, 255, 42]));
  await writeFile(path.join(root, '.secret'), 'excluded');
  const evidence = await findFiles(root);
  assert.equal(evidence.files.length, 1);
  assert.equal(evidence.root, root);
  assert.equal((await findFiles(path.join(root, 'nested', '*'))).root, path.join(root, 'nested'));
});

test('findFiles keeps the @actions/glob semantics on patched minimatch', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'artifact-glob-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['a/one.txt', 'a/b/two.txt', 'a/b/skip.log', 'a/.dot/x.txt', 'c/d/deep.bin', 'single.md']) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), name);
  }
  await symlink(path.join(root, 'a/one.txt'), path.join(root, 'a/link.txt'));
  await symlink(path.join(root, 'c'), path.join(root, 'a/linkdir'));
  const found = async input => {
    const { files, root: base } = await findFiles(input);
    return { files: files.map(file => path.relative(root, file)), root: path.relative(root, base) || '.' };
  };
  const at = name => path.join(root, name);
  // A matched directory contributes its descendants; hidden entries and symlinks never do.
  assert.deepEqual(await found(at('a')), { files: ['a/b/skip.log', 'a/b/two.txt', 'a/one.txt'], root: 'a' });
  assert.deepEqual(await found(at('a/*')), { files: ['a/b/skip.log', 'a/b/two.txt', 'a/one.txt'], root: 'a' });
  assert.deepEqual(await found(at('a/**/*.txt')), { files: ['a/b/two.txt', 'a/one.txt'], root: 'a' });
  assert.deepEqual(await found(at('*/b')), { files: ['a/b/skip.log', 'a/b/two.txt'], root: '.' });
  assert.deepEqual(await found(at('a/[ab]/t?o.txt')), { files: ['a/b/two.txt'], root: 'a' });
  // One pattern per line, `#` comments, `!` exclusions; the root spans every search path.
  assert.deepEqual(await found(`# evidence\n${at('a')}\n!${at('a/b/skip.log')}\n${at('c')}`),
    { files: ['a/b/two.txt', 'a/one.txt', 'c/d/deep.bin'], root: '.' });
  assert.deepEqual(await found(at('single.md')), { files: ['single.md'], root: '.' });
  // Braces stay literal (nobrace), as in @actions/glob.
  await assert.rejects(findFiles(at('a/b/*.{txt,log}')), /No files/);
  await assert.rejects(findFiles(at('a/link.txt')), /No files/);
  await assert.rejects(findFiles(at('a/linkdir')), /No files/);
  await assert.rejects(findFiles(`!${at('a')}`), /No files/);
  // GHSA-g3hv-75wg-m249 amplifies `**/../` chains; resolved, patched patterns stay cheap.
  const started = Date.now();
  await assert.rejects(findFiles(at(`${'**/../'.repeat(12)}missing`)), /No files/);
  assert.ok(Date.now() - started < 5000, 'pattern preprocessing is bounded');
});

test('Pages artifact contains artifact.tar and the complete visible site', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'pages-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'index.html'), 'site');
  const archive = await packagePages(root);
  t.after(archive.cleanup);
  assert.equal(path.basename(archive.file), 'artifact.tar');
  assert.match(execFileSync('tar', ['-tf', archive.file], { encoding: 'utf8' }), /index.html/);
  assert.equal(execFileSync('tar', ['-xOf', archive.file, './index.html'], { encoding: 'utf8' }), 'site');
});

test('download retries transport, skips deprecated extraction and enforces digest', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'download-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  let extracts = 0;
  const client = { downloadArtifact: async (id, options) => {
    assert.equal(options.skipDecompress, true);
    assert.equal(options.expectedHash, `sha256:${'a'.repeat(64)}`);
    if (++calls === 1) throw network();
    await writeFile(path.join(options.path, 'archive.zip'), 'bytes');
    return { digestMismatch: false };
  } };
  await downloadWithRetry(client, { id: 1, name: 'dist', digest: `sha256:${'a'.repeat(64)}` }, root, {
    ...noWait,
    extract: async (archive, destination) => {
      assert.equal(await readFile(archive, 'utf8'), 'bytes');
      assert.equal(destination, root);
      extracts++;
    },
  });
  assert.equal(calls, 2);
  assert.equal(extracts, 1);
  await assert.rejects(downloadWithRetry({ downloadArtifact: async () => ({ digestMismatch: true }) }, { id: 1, digest: `sha256:${'a'.repeat(64)}` }, root, noWait), /digest/i);
  await assert.rejects(downloadWithRetry(client, { id: 1 }, root, noWait), /digest/i);
});

test('archiver-utils and readdir-glob use patched glob and minimatch without changing matches or ZIP bytes', async (t) => {
  const { createRequire } = await import('node:module');
  const actionDir = new URL('../.github/actions/artifact/', import.meta.url);
  const lock = JSON.parse(await readFile(new URL('package-lock.json', actionDir), 'utf8'));
  const globs = Object.entries(lock.packages).filter(([key]) => key.endsWith('node_modules/glob'));
  // glob 14.0.2+ and minimatch 11.0.1+ fix GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249 (issue #132).
  assert.deepEqual(globs.map(([key, value]) => [key, value.version]), [['node_modules/glob', '14.0.3']]);
  const minimatches = Object.entries(lock.packages).filter(([key]) => key.endsWith('node_modules/minimatch'));
  assert.deepEqual(minimatches.map(([key, value]) => [key, value.version]), [['node_modules/minimatch', '11.0.4']]);
  assert.ok(Object.values(lock.packages).every(value => !value.deprecated), 'no deprecated packages are locked');

  const require = createRequire(new URL('package.json', actionDir));
  let archiver;
  try { archiver = require('archiver'); } catch { return t.skip('artifact dependencies are not installed'); }
  const file = createRequire(require.resolve('archiver'))('archiver-utils').file;
  const root = await mkdtemp(path.join(tmpdir(), 'glob-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'a/b'), { recursive: true });
  for (const name of ['a/one.txt', 'a/b/two.txt', 'a/b/skip.log', '.hidden.txt']) await writeFile(path.join(root, name), name);
  assert.deepEqual(file.expand({ cwd: root }, ['**/*.txt', '!**/skip*']).sort(), ['a/b/two.txt', 'a/one.txt']);
  assert.deepEqual(file.expand({ cwd: root, dot: true }, ['*.txt']).sort(), ['.hidden.txt']);
  assert.deepEqual(file.expand({ cwd: root, filter: 'isDirectory' }, ['a/**']).sort(), ['a', 'a/b']);

  const zip = async () => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', chunk => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { archive.on('end', resolve); archive.on('error', reject); });
    archive.glob('**/*.txt', { cwd: root, dot: true }, { date: new Date(0) });
    await archive.finalize();
    await done;
    return Buffer.concat(chunks);
  };
  const bytes = await zip();
  assert.ok(bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'latin1')));
  assert.ok(bytes.equals(await zip()), 'ZIP bytes are deterministic');
  for (const name of ['a/one.txt', 'a/b/two.txt', '.hidden.txt']) assert.ok(bytes.includes(Buffer.from(name)));
});
