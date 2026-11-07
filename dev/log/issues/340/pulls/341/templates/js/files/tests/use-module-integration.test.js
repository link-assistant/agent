// Exercise the installed packages used by release jobs, with network disabled.
import assert from 'node:assert/strict';
import { describe } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';
import {
  loadCommandStream,
  loadLinoArguments,
} from '../scripts/use-module.mjs';

async function offline(run) {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error(
      'Network access is forbidden in release dependency loading'
    );
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('lockfile-installed release helpers work offline', () => {
  itUnless(sandboxed)(
    'exposes callable command and argument APIs',
    async () => {
      await offline(async () => {
        const commandStream = await loadCommandStream();
        const argumentsModule = await loadLinoArguments();
        assert.equal(typeof commandStream.$, 'function');
        assert.equal(typeof argumentsModule.makeConfig, 'function');
        const result = await commandStream.$`echo offline`;
        assert.equal(result.code, 0);
        assert.equal(result.stdout.trim(), 'offline');
      });
    }
  );

  itUnless(sandboxed)('rejects when a real command exits nonzero', async () => {
    await offline(async () => {
      const { $ } = await loadCommandStream();
      await assert.rejects(
        async () => await $`exit 3`,
        (error) => error.code === 3
      );
    });
  });
});
