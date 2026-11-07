// Bounded reproduction of the pinned download action's unzip-stream dependency.
// Install unzip-stream@0.3.4 in an isolated directory, set UNZIP_STREAM_ROOT to
// that directory, then run node FILE. The child has finite time and memory.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
if (!process.env.UNZIP_STREAM_ROOT) throw new Error('Set UNZIP_STREAM_ROOT to the isolated installation');
const requireFixture = createRequire(resolve(process.env.UNZIP_STREAM_ROOT, 'package.json'));
const source = `
  const parser = require(${JSON.stringify(requireFixture.resolve('unzip-stream'))}).Parse();
  parser.on('error', (error) => { throw error; });
  parser.resume();
  // Complete empty ZIP, avoiding the old parser's truncated-input flush loop.
  parser.end(Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));
`;
const result = spawnSync(process.execPath,
  // The action bundles dependencies into dist/. Enable dependency warnings for
  // this isolated node_modules installation to reproduce that application path.
  ['--throw-deprecation', '--pending-deprecation', '--max-old-space-size=64', '-e', source],
  { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
if (result.error) throw result.error;
process.stdout.write(result.stderr);
assert.notEqual(result.status, 0, 'Old extractor must fail with deprecations fatal');
assert.match(result.stderr, /DEP0005/, 'Failure must reproduce the Buffer deprecation');
