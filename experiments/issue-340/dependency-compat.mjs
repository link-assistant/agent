// Bounded compatibility probes for replacements of deprecated transitives.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { transformSync } = require('@babel/core');
const plugin = require('babel-plugin-module-resolver');
const transformed = transformSync('import value from "@agent/util/error.ts";', {
  babelrc: false,
  configFile: false,
  plugins: [
    [
      plugin,
      {
        alias: {
          '@agent': `${path.dirname(
            fileURLToPath(
              new URL('../../js/src/util/error.ts', import.meta.url)
            )
          )}/..`,
        },
      },
    ],
  ],
});
assert.match(transformed.code, /js\/src\/util\/error/);
const blobRequire = createRequire(require.resolve('fetch-blob'));
const Replacement = blobRequire('node-domexception');
assert.equal(Replacement, globalThis.DOMException);
assert.equal(new Replacement('aborted', 'AbortError').name, 'AbortError');
const { Blob } = await import(require.resolve('fetch-blob'));
assert.equal(await new Blob(['native compatible']).text(), 'native compatible');
console.log(
  'Babel aliases and native DOMException/fetch-blob compatibility verified.'
);
