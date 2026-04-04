import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  config,
  initConfig,
  resetConfig,
  isVerbose,
  setVerbose,
  updateConfig,
  getConfigSnapshot,
  isConfigInitialized,
  type AgentConfig,
} from '../src/config/agent-config';

describe('agent-config', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save env vars that might interfere
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('LINK_ASSISTANT_AGENT_')) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
    resetConfig();
  });

  afterEach(() => {
    // Restore env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('LINK_ASSISTANT_AGENT_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    resetConfig();
  });

  describe('default config', () => {
    test('verbose defaults to false', () => {
      expect(config.verbose).toBe(false);
    });

    test('dryRun defaults to false', () => {
      expect(config.dryRun).toBe(false);
    });

    test('outputResponseModel defaults to true', () => {
      expect(config.outputResponseModel).toBe(true);
    });

    test('summarizeSession defaults to true', () => {
      expect(config.summarizeSession).toBe(true);
    });

    test('retryOnRateLimits defaults to true', () => {
      expect(config.retryOnRateLimits).toBe(true);
    });

    test('retryTimeout defaults to 604800', () => {
      expect(config.retryTimeout).toBe(604800);
    });

    test('maxRetryDelay defaults to 1200', () => {
      expect(config.maxRetryDelay).toBe(1200);
    });

    test('streamChunkTimeoutMs defaults to 120000', () => {
      expect(config.streamChunkTimeoutMs).toBe(120000);
    });

    test('streamStepTimeoutMs defaults to 600000', () => {
      expect(config.streamStepTimeoutMs).toBe(600000);
    });

    test('verifyImagesAtReadTool defaults to true', () => {
      expect(config.verifyImagesAtReadTool).toBe(true);
    });
  });

  describe('env var defaults', () => {
    test('LINK_ASSISTANT_AGENT_VERBOSE=true sets verbose', () => {
      process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
      resetConfig();
      expect(config.verbose).toBe(true);
    });

    test('LINK_ASSISTANT_AGENT_DRY_RUN=1 sets dryRun', () => {
      process.env.LINK_ASSISTANT_AGENT_DRY_RUN = '1';
      resetConfig();
      expect(config.dryRun).toBe(true);
    });

    test('LINK_ASSISTANT_AGENT_RETRY_TIMEOUT overrides default', () => {
      process.env.LINK_ASSISTANT_AGENT_RETRY_TIMEOUT = '1000';
      resetConfig();
      expect(config.retryTimeout).toBe(1000);
    });

    test('LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL=false disables it', () => {
      process.env.LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL = 'false';
      resetConfig();
      expect(config.outputResponseModel).toBe(false);
    });

    test('LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION=0 disables it', () => {
      process.env.LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION = '0';
      resetConfig();
      expect(config.summarizeSession).toBe(false);
    });
  });

  describe('initConfig', () => {
    test('parses --verbose flag', () => {
      initConfig(['node', 'test', '--verbose']);
      expect(config.verbose).toBe(true);
    });

    test('parses --dry-run flag', () => {
      initConfig(['node', 'test', '--dry-run']);
      expect(config.dryRun).toBe(true);
    });

    test('parses --retry-timeout value', () => {
      initConfig(['node', 'test', '--retry-timeout', '5000']);
      expect(config.retryTimeout).toBe(5000);
    });

    test('sets initialized flag', () => {
      expect(isConfigInitialized()).toBe(false);
      initConfig(['node', 'test']);
      expect(isConfigInitialized()).toBe(true);
    });

    test('propagates verbose to env var for subprocess resilience', () => {
      initConfig(['node', 'test', '--verbose']);
      expect(process.env.LINK_ASSISTANT_AGENT_VERBOSE).toBe('true');
    });

    test('mutates config in-place so existing references stay valid', () => {
      const ref = config;
      initConfig(['node', 'test', '--verbose']);
      expect(ref.verbose).toBe(true);
      expect(ref).toBe(config);
    });
  });

  describe('isVerbose', () => {
    test('returns false when verbose is off', () => {
      expect(isVerbose()).toBe(false);
    });

    test('returns true when config.verbose is true', () => {
      config.verbose = true;
      expect(isVerbose()).toBe(true);
    });

    test('returns true when env var is set (subprocess resilience)', () => {
      process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
      expect(isVerbose()).toBe(true);
    });
  });

  describe('setVerbose', () => {
    test('sets config.verbose and env var', () => {
      setVerbose(true);
      expect(config.verbose).toBe(true);
      expect(process.env.LINK_ASSISTANT_AGENT_VERBOSE).toBe('true');
    });

    test('clears env var when set to false', () => {
      setVerbose(true);
      setVerbose(false);
      expect(config.verbose).toBe(false);
      expect(process.env.LINK_ASSISTANT_AGENT_VERBOSE).toBeUndefined();
    });
  });

  describe('updateConfig', () => {
    test('updates specific fields', () => {
      updateConfig({ retryTimeout: 999 });
      expect(config.retryTimeout).toBe(999);
    });

    test('syncs verbose to env var', () => {
      updateConfig({ verbose: true });
      expect(process.env.LINK_ASSISTANT_AGENT_VERBOSE).toBe('true');
    });

    test('returns the updated config', () => {
      const result = updateConfig({ dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result).toBe(config);
    });
  });

  describe('getConfigSnapshot', () => {
    test('returns non-empty values', () => {
      const snapshot = getConfigSnapshot();
      expect(snapshot.retryOnRateLimits).toBe(true);
      expect(snapshot.retryTimeout).toBe(604800);
    });

    test('excludes empty string values', () => {
      const snapshot = getConfigSnapshot();
      // config, configDir, configContent default to '' and should be excluded
      expect('config' in snapshot).toBe(false);
      expect('configDir' in snapshot).toBe(false);
    });
  });

  describe('resetConfig', () => {
    test('resets to defaults', () => {
      initConfig(['node', 'test', '--verbose', '--dry-run']);
      expect(config.verbose).toBe(true);
      expect(config.dryRun).toBe(true);
      // Clean env vars set by initConfig before resetting
      delete process.env.LINK_ASSISTANT_AGENT_VERBOSE;
      delete process.env.LINK_ASSISTANT_AGENT_DRY_RUN;
      resetConfig();
      expect(config.verbose).toBe(false);
      expect(config.dryRun).toBe(false);
    });

    test('clears initialized flag', () => {
      initConfig(['node', 'test']);
      expect(isConfigInitialized()).toBe(true);
      resetConfig();
      expect(isConfigInitialized()).toBe(false);
    });

    test('preserves object identity', () => {
      const ref = config;
      resetConfig();
      expect(ref).toBe(config);
    });
  });
});
