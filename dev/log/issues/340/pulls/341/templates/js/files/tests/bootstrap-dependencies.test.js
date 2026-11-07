/* eslint local/no-changelog-comments: "off" */

/**
 * Guards for the module-scope dependency bootstrap.
 *
 * Without it, a use-m load failure kills the script during module
 * initialisation: nothing is logged and nothing reaches GITHUB_OUTPUT, so the
 * job reports a bare loader stack and the workflow step that reads
 * `published` sees an empty value.
 */

import { describe, it, expect } from 'test-anywhere';

import {
  bootstrapDependencies,
  writeOutputs,
} from '../scripts/bootstrap-dependencies.mjs';

function recorder() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

describe('bootstrapDependencies', () => {
  it('returns a single loaded module when given one loader', async () => {
    const loaded = await bootstrapDependencies(async () => ({ $: () => {} }));
    expect(typeof loaded.$).toBe('function');
  });

  it('returns modules in the order of the loaders', async () => {
    const [first, second] = await bootstrapDependencies([
      async () => 'command-stream',
      async () => 'lino-arguments',
    ]);
    expect([first, second]).toEqual(['command-stream', 'lino-arguments']);
  });

  it('reports the failure as a GitHub error annotation', async () => {
    const { lines, log } = recorder();
    const codes = [];
    await bootstrapDependencies(
      async () => {
        throw new Error(
          'Failed to load use-m from https://unpkg.com/use-m/use.js'
        );
      },
      { log, exit: (code) => codes.push(code) }
    ).catch(() => {});
    expect(lines[0].startsWith('::error::Failed to load use-m')).toBe(true);
    expect(codes).toEqual([1]);
  });

  it('prints the cause, which carries the transport-level reason', async () => {
    const { lines, log } = recorder();
    await bootstrapDependencies(
      async () => {
        throw new Error('load failed', {
          cause: new Error('Connect Timeout Error'),
        });
      },
      { log, exit: () => {} }
    ).catch(() => {});
    expect(lines.some((l) => l.includes('Connect Timeout Error'))).toBe(true);
  });

  it('writes the fallback outputs before exiting', async () => {
    const written = [];
    await bootstrapDependencies(
      async () => {
        throw new Error('offline');
      },
      {
        outputs: { published: 'false' },
        log: () => {},
        exit: () => {},
        env: { GITHUB_OUTPUT: '/tmp/output' },
        append: (file, data) => written.push([file, data]),
      }
    ).catch(() => {});
    expect(written).toEqual([['/tmp/output', 'published=false\n']]);
  });

  it('does not run later loaders once one has failed', async () => {
    const calls = [];
    await bootstrapDependencies(
      [
        async () => {
          calls.push('first');
          throw new Error('offline');
        },
        async () => {
          calls.push('second');
        },
      ],
      { log: () => {}, exit: () => {} }
    ).catch(() => {});
    expect(calls).toEqual(['first']);
  });
});

describe('writeOutputs', () => {
  it('writes nothing when GITHUB_OUTPUT is unset', () => {
    const written = [];
    const lines = writeOutputs(
      { published: 'false' },
      { env: {}, append: (file, data) => written.push([file, data]) }
    );
    expect(lines).toEqual([]);
    expect(written).toEqual([]);
  });

  it('writes one line per output', () => {
    const written = [];
    writeOutputs(
      { published: 'false', reason: 'cdn' },
      {
        env: { GITHUB_OUTPUT: '/tmp/out' },
        append: (file, data) => written.push(data),
      }
    );
    expect(written).toEqual(['published=false\nreason=cdn\n']);
  });

  it('never throws when the output file cannot be written', () => {
    const lines = writeOutputs(
      { published: 'false' },
      {
        env: { GITHUB_OUTPUT: '/tmp/out' },
        append: () => {
          throw new Error('EACCES');
        },
      }
    );
    expect(lines).toEqual([]);
  });
});
