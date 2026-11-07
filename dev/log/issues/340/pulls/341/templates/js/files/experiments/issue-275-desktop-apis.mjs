// Bounded API compatibility probe: forcing modern majors into legacy consumers
// either loses a callback or changes the callable export used by temp.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { URL } from 'node:url';

const require = createRequire(
  new URL(
    '../examples/universal-app/node_modules/@capacitor/cli/package.json',
    import.meta.url
  )
);
const rimraf = require('rimraf');
const glob = createRequire(require.resolve('rimraf'))('glob');
let timer;
const outcome = await Promise.race([
  promisify(glob.glob)('package.json', { cwd: process.cwd() }).then(
    () => 'callback'
  ),
  new Promise((resolve) => {
    timer = setTimeout(() => resolve('no callback'), 300);
  }),
]);
clearTimeout(timer);
assert.equal(outcome, 'no callback');
assert.equal(typeof rimraf, 'object');
assert.equal(typeof rimraf.rimraf, 'function');
console.log(
  "Modern glob does not settle asar 3 callback promisification; modern rimraf is not temp's callable export."
);
