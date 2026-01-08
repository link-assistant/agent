import { test, expect, describe } from 'bun:test';
import { withTimeout } from '../src/util/timeout';
import { MCP } from '../src/mcp';

describe('MCP Tool Call Timeout', () => {
  describe('withTimeout utility', () => {
    test('resolves when promise completes within timeout', async () => {
      const result = await withTimeout(Promise.resolve('success'), 1000);
      expect(result).toBe('success');
    });

    test('rejects with timeout error when promise takes too long', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('late'), 500);
      });

      await expect(withTimeout(slowPromise, 50)).rejects.toThrow(
        'Operation timed out after 50ms'
      );
    });

    test('clears timeout when promise resolves', async () => {
      // This test ensures the timeout is cleared and doesn't cause issues
      const result = await withTimeout(Promise.resolve('quick'), 1000);
      expect(result).toBe('quick');
      // Wait a bit to ensure no lingering timeout errors
      await new Promise((r) => setTimeout(r, 50));
    });

    test('handles promise rejection', async () => {
      await expect(
        withTimeout(Promise.reject(new Error('Original error')), 1000)
      ).rejects.toThrow('Original error');
    });
  });

  describe('MCP timeout constants', () => {
    test('BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT is 2 minutes', () => {
      expect(MCP.BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT).toBe(120000);
    });

    test('BUILTIN_MAX_TOOL_CALL_TIMEOUT is 10 minutes', () => {
      expect(MCP.BUILTIN_MAX_TOOL_CALL_TIMEOUT).toBe(600000);
    });

    test('deprecated DEFAULT_TOOL_CALL_TIMEOUT equals BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT', () => {
      expect(MCP.DEFAULT_TOOL_CALL_TIMEOUT).toBe(
        MCP.BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT
      );
    });

    test('deprecated MAX_TOOL_CALL_TIMEOUT equals BUILTIN_MAX_TOOL_CALL_TIMEOUT', () => {
      expect(MCP.MAX_TOOL_CALL_TIMEOUT).toBe(MCP.BUILTIN_MAX_TOOL_CALL_TIMEOUT);
    });
  });

  describe('MCP timeout configuration schema', () => {
    test('McpLocal schema accepts tool_call_timeout', async () => {
      const { Config } = await import('../src/config/config');

      const validConfig = {
        type: 'local' as const,
        command: ['npx', '@playwright/mcp@latest'],
        tool_call_timeout: 300000,
      };

      const result = Config.McpLocal.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_call_timeout).toBe(300000);
      }
    });

    test('McpLocal schema accepts tool_timeouts', async () => {
      const { Config } = await import('../src/config/config');

      const validConfig = {
        type: 'local' as const,
        command: ['npx', '@playwright/mcp@latest'],
        tool_timeouts: {
          browser_run_code: 300000,
          browser_install: 600000,
        },
      };

      const result = Config.McpLocal.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_timeouts).toEqual({
          browser_run_code: 300000,
          browser_install: 600000,
        });
      }
    });

    test('McpRemote schema accepts tool_call_timeout', async () => {
      const { Config } = await import('../src/config/config');

      const validConfig = {
        type: 'remote' as const,
        url: 'https://example.com/mcp',
        tool_call_timeout: 180000,
      };

      const result = Config.McpRemote.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_call_timeout).toBe(180000);
      }
    });

    test('McpRemote schema accepts tool_timeouts', async () => {
      const { Config } = await import('../src/config/config');

      const validConfig = {
        type: 'remote' as const,
        url: 'https://example.com/mcp',
        tool_timeouts: {
          long_operation: 500000,
        },
      };

      const result = Config.McpRemote.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_timeouts).toEqual({
          long_operation: 500000,
        });
      }
    });

    test('tool_call_timeout must be positive integer', async () => {
      const { Config } = await import('../src/config/config');

      const invalidConfig = {
        type: 'local' as const,
        command: ['npx', '@playwright/mcp@latest'],
        tool_call_timeout: -1000,
      };

      const result = Config.McpLocal.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    test('tool_timeouts values must be positive integers', async () => {
      const { Config } = await import('../src/config/config');

      const invalidConfig = {
        type: 'local' as const,
        command: ['npx', '@playwright/mcp@latest'],
        tool_timeouts: {
          browser_run_code: -500,
        },
      };

      const result = Config.McpLocal.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('Timeout error messages', () => {
    test('timeout error includes helpful message', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('late'), 500);
      });

      try {
        await withTimeout(slowPromise, 10);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('timed out');
        expect((error as Error).message).toContain('10ms');
      }
    });
  });
});

describe('Global MCP defaults configuration', () => {
  test('mcp_defaults schema accepts tool_call_timeout', async () => {
    const { Config } = await import('../src/config/config');

    const validConfig = {
      mcp_defaults: {
        tool_call_timeout: 180000,
      },
    };

    const result = Config.Info.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcp_defaults?.tool_call_timeout).toBe(180000);
    }
  });

  test('mcp_defaults schema accepts max_tool_call_timeout', async () => {
    const { Config } = await import('../src/config/config');

    const validConfig = {
      mcp_defaults: {
        max_tool_call_timeout: 900000, // 15 minutes
      },
    };

    const result = Config.Info.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcp_defaults?.max_tool_call_timeout).toBe(900000);
    }
  });

  test('mcp_defaults schema accepts both timeout options', async () => {
    const { Config } = await import('../src/config/config');

    const validConfig = {
      mcp_defaults: {
        tool_call_timeout: 180000,
        max_tool_call_timeout: 1200000, // 20 minutes
      },
    };

    const result = Config.Info.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcp_defaults?.tool_call_timeout).toBe(180000);
      expect(result.data.mcp_defaults?.max_tool_call_timeout).toBe(1200000);
    }
  });

  test('mcp_defaults timeouts must be positive integers', async () => {
    const { Config } = await import('../src/config/config');

    const invalidConfig = {
      mcp_defaults: {
        tool_call_timeout: -1000,
      },
    };

    const result = Config.Info.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  test('mcp_defaults max_tool_call_timeout must be positive integer', async () => {
    const { Config } = await import('../src/config/config');

    const invalidConfig = {
      mcp_defaults: {
        max_tool_call_timeout: 0,
      },
    };

    const result = Config.Info.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});

describe('Full MCP configuration example', () => {
  test('complete config with all timeout options validates', async () => {
    const { Config } = await import('../src/config/config');

    // This represents the full configuration users might use
    const fullConfig = {
      type: 'local' as const,
      command: ['npx', '@playwright/mcp@latest'],
      enabled: true,
      timeout: 10000, // Server connection timeout
      tool_call_timeout: 180000, // Default tool execution timeout (3 minutes)
      tool_timeouts: {
        // Per-tool overrides
        browser_run_code: 300000, // 5 minutes for browser operations
        browser_install: 600000, // 10 minutes for installation
        browser_navigate: 60000, // 1 minute for navigation
      },
    };

    const result = Config.McpLocal.safeParse(fullConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeout).toBe(10000);
      expect(result.data.tool_call_timeout).toBe(180000);
      expect(result.data.tool_timeouts).toEqual({
        browser_run_code: 300000,
        browser_install: 600000,
        browser_navigate: 60000,
      });
    }
  });

  test('complete config with global mcp_defaults validates', async () => {
    const { Config } = await import('../src/config/config');

    // This represents the full configuration with global defaults
    const fullConfig = {
      mcp_defaults: {
        tool_call_timeout: 180000, // 3 minutes global default
        max_tool_call_timeout: 1800000, // 30 minutes global max
      },
      mcp: {
        playwright: {
          type: 'local' as const,
          command: ['npx', '@playwright/mcp@latest'],
          // Per-server override
          tool_call_timeout: 300000, // 5 minutes for this server
          tool_timeouts: {
            browser_install: 600000, // 10 minutes for installation
          },
        },
      },
    };

    const result = Config.Info.safeParse(fullConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcp_defaults?.tool_call_timeout).toBe(180000);
      expect(result.data.mcp_defaults?.max_tool_call_timeout).toBe(1800000);
      expect(result.data.mcp?.playwright?.tool_call_timeout).toBe(300000);
    }
  });
});
