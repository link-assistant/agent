/* eslint local/no-changelog-comments: "off" */

import { describe, it, expect } from 'test-anywhere';

import {
  describeModule,
  loadCommandStream,
  loadLinoArguments,
  resolveNamedExport,
} from '../scripts/use-module.mjs';

const dollar = () => {};

function commandStreamExports() {
  return Object.assign(() => {}, { $: dollar, sh: () => {}, run: () => {} });
}

/**
 * Namespace `import()` produces for a CommonJS file on Node < 22.12. use-m
 * unwraps it because `default` is the only key, so `const { $ }` works.
 */
function nodeTwentyNamespace() {
  return { default: commandStreamExports() };
}

/**
 * Same file on Node >= 22.12: the synthetic `module.exports` key makes use-m
 * skip the unwrap and hand the raw namespace to the caller.
 */
function nodeTwentyFourNamespace() {
  return {
    default: commandStreamExports(),
    'module.exports': commandStreamExports(),
  };
}

describe('use-module interop shim', () => {
  it('reproduces the Node 24 namespace that breaks destructuring', () => {
    const { $ } = nodeTwentyFourNamespace();
    expect($).toBe(undefined);
  });

  it('resolves $ from the Node >= 22.12 CommonJS namespace', () => {
    const resolved = resolveNamedExport(
      nodeTwentyFourNamespace(),
      '$',
      'command-stream'
    );
    expect(typeof resolved.$).toBe('function');
  });

  it('resolves $ from the Node < 22.12 CommonJS namespace', () => {
    const resolved = resolveNamedExport(
      nodeTwentyNamespace(),
      '$',
      'command-stream'
    );
    expect(typeof resolved.$).toBe('function');
  });

  it('resolves $ when use-m already unwrapped the module', () => {
    const resolved = resolveNamedExport(
      commandStreamExports(),
      '$',
      'command-stream'
    );
    expect(typeof resolved.$).toBe('function');
  });

  it('resolves $ from a real ES module namespace with named exports', () => {
    const namespace = { $: dollar, sh: () => {}, default: dollar };
    const resolved = resolveNamedExport(namespace, '$', 'command-stream');
    expect(resolved).toBe(namespace);
  });

  it('resolves a double-wrapped default', () => {
    const resolved = resolveNamedExport(
      { default: { default: commandStreamExports() } },
      '$',
      'command-stream'
    );
    expect(typeof resolved.$).toBe('function');
  });

  it('names the observed keys when no candidate exposes the export', () => {
    let message = '';
    try {
      resolveNamedExport({ nope: 1 }, '$', 'command-stream');
    } catch (error) {
      message = error.message;
    }
    expect(message.includes('Installed command-stream')).toBe(true);
    expect(message.includes('keys [nope]')).toBe(true);
  });

  it('reports the received value when use-m resolved nothing', () => {
    let message = '';
    try {
      resolveNamedExport(undefined, '$', 'command-stream');
    } catch (error) {
      message = error.message;
    }
    expect(message.includes('Received undefined')).toBe(true);
  });

  it('describes null, primitives and objects', () => {
    expect(describeModule(null)).toBe('null');
    expect(describeModule(7)).toBe('number');
    expect(describeModule({ a: 1, b: 2 })).toBe('object with keys [a, b]');
  });

  it('loads command-stream through an injected use() implementation', async () => {
    const calls = [];
    const use = async (name) => {
      calls.push(name);
      return nodeTwentyFourNamespace();
    };
    const module = await loadCommandStream(use);
    expect(calls).toEqual(['command-stream']);
    expect(typeof module.$).toBe('function');
  });

  it('loads lino-arguments through an injected use() implementation', async () => {
    const calls = [];
    const use = async (name) => {
      calls.push(name);
      return { default: { makeConfig: () => ({}) } };
    };
    const module = await loadLinoArguments(use);
    expect(calls).toEqual(['lino-arguments']);
    expect(typeof module.makeConfig).toBe('function');
  });
});

describe('loadCommandStream turns on errexit', () => {
  function shellExports(errexitCalls) {
    return Object.assign(commandStreamExports(), {
      shell: {
        errexit: (value) => {
          errexitCalls.push(value);
        },
      },
    });
  }

  it('enables shell.errexit on the resolved module', async () => {
    const errexitCalls = [];
    const use = async () => ({ default: shellExports(errexitCalls) });

    await loadCommandStream(use);

    expect(errexitCalls).toEqual([true]);
  });

  it('still loads a module that exposes no shell', async () => {
    const use = async () => ({ default: commandStreamExports() });

    const module = await loadCommandStream(use);

    expect(typeof module.$).toBe('function');
  });
});
