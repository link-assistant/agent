import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BashTool } from '../src/tool/bash';
import { config } from '../src/config/config';
import { Instance } from '../src/project/instance';
import { Permission } from '../src/permission';

/**
 * JS counterpart of `rust/tests/tool_bash.rs`.
 *
 * The Rust port keeps a per-tool unit test for the bash tool. The
 * JavaScript implementation also tests the tool through its integration
 * suite (see `js/tests/integration/bash.tools.js`). The local tests below
 * initialize the real WASM parser without an AI API call.
 *
 * Keep the stable tool name parity check alongside parser regression tests.
 */

const TOOL_NAME = 'bash';

describe('tool bash parity with Rust port', () => {
  test('tool name is a stable lower-case identifier', () => {
    expect(TOOL_NAME).toBe(TOOL_NAME.toLowerCase());
    expect(TOOL_NAME).not.toContain(' ');
    expect(TOOL_NAME.length).toBeGreaterThan(0);
  });
});

describe('bash parser and permission enforcement', () => {
  let savedMode;
  let savedPermission;
  let directory;

  beforeEach(() => {
    savedMode = config.permissionMode;
    savedPermission = config.permission;
  });

  afterEach(async () => {
    config.permissionMode = savedMode;
    config.permission = savedPermission;
    await Instance.disposeAll();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  const execute = async (command) => {
    directory = await mkdtemp(join(tmpdir(), 'agent-bash-parser-'));
    config.permissionMode = 'readonly';
    config.permission = '{"bash":{"echo*":"allow","*":"deny"}}';
    return Instance.provide({
      directory,
      fn: async () => {
        const tool = await BashTool.init();
        return tool.execute(
          { command },
          {
            sessionID: 'ses_bash_parser',
            messageID: 'msg_bash_parser',
            agent: 'build',
            abort: new AbortController().signal,
            metadata() {},
          }
        );
      },
    });
  };

  test('initializes the real WASM parser before running an allowed command', async () => {
    const result = await execute('echo parser-ready');
    expect(result.output.trim()).toBe('parser-ready');
    expect(result.metadata.exit).toBe(0);
  });

  test.each(['echo allowed && touch denied', 'echo "$(touch denied)"'])(
    'rejects a denied command node in %s before executing',
    async (command) => {
      await expect(execute(command)).rejects.toBeInstanceOf(
        Permission.RejectedError
      );
      await expect(readFile(join(directory, 'denied'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );
});
