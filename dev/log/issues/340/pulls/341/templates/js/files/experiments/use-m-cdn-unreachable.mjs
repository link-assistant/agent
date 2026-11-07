#!/usr/bin/env node
// Regression probe: release dependency loading must work with the CDN offline.
import assert from 'node:assert/strict';
import {
  loadCommandStream,
  loadLinoArguments,
} from '../scripts/use-module.mjs';
globalThis.fetch = () => {
  throw new Error('Simulated network outage');
};
const { $ } = await loadCommandStream();
const { makeConfig } = await loadLinoArguments();
assert.equal(typeof makeConfig, 'function');
assert.equal((await $`echo offline`).stdout.trim(), 'offline');
await assert.rejects(
  async () => await $`exit 3`,
  (error) => error.code === 3
);
console.log(
  'Installed release helpers work offline and reject failed commands.'
);
