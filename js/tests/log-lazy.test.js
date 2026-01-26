import { describe, it, expect } from 'bun:test';

/**
 * Tests for JSON lazy logging functionality.
 *
 * These tests verify that:
 * 1. The lazy logging module exports are correct
 * 2. Log module has lazy logging support
 * 3. All log levels are available
 */

describe('Log Lazy JSON Output', () => {
  describe('Log module lazy support', () => {
    it('should have logging methods that support both immediate and lazy styles', async () => {
      const { Log } = await import('../src/util/log.ts');

      const logger = Log.create({ service: 'test' });

      // All log methods should support both immediate and lazy (callback) styles
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should have isJsonOutput function', async () => {
      const { Log } = await import('../src/util/log.ts');
      expect(typeof Log.isJsonOutput).toBe('function');
    });

    it('should have syncWithVerboseFlag function', async () => {
      const { Log } = await import('../src/util/log.ts');
      expect(typeof Log.syncWithVerboseFlag).toBe('function');
    });

    it('should support all standard log levels', async () => {
      const { Log } = await import('../src/util/log.ts');

      const logger = Log.create({ service: 'level-test' });

      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should support tagging', async () => {
      const { Log } = await import('../src/util/log.ts');

      const logger = Log.create({ service: 'tag-test' });
      const tagged = logger.tag('action', 'testing');

      expect(tagged).toBe(logger);
    });

    it('should support cloning', async () => {
      const { Log } = await import('../src/util/log.ts');

      // Use unique service name to avoid cache
      const uniqueService = `clone-test-${Date.now()}`;
      const logger = Log.create({ service: uniqueService });
      const cloned = logger.clone();

      // Cloned logger should have same interface
      expect(typeof cloned.info).toBe('function');
      expect(typeof cloned.debug).toBe('function');
      expect(typeof cloned.warn).toBe('function');
      expect(typeof cloned.error).toBe('function');
    });

    it('should support time tracking', async () => {
      const { Log } = await import('../src/util/log.ts');

      const logger = Log.create({ service: 'time-test' });
      const timer = logger.time('test-operation');

      expect(timer).toHaveProperty('stop');
      expect(typeof timer.stop).toBe('function');
      expect(timer[Symbol.dispose]).toBeDefined();
    });
  });

  describe('Log level constants', () => {
    it('should export Level schema', async () => {
      const { Log } = await import('../src/util/log.ts');

      expect(Log.Level).toBeDefined();
      // Check that the enum values are correct
      const parsed = Log.Level.safeParse('DEBUG');
      expect(parsed.success).toBe(true);
    });
  });
});

describe('Lazy Logger Module', () => {
  it('should export createLazyLogger function', async () => {
    const module = await import('../src/util/log-lazy.ts');
    expect(typeof module.createLazyLogger).toBe('function');
  });

  it('should export lazyLog instance', async () => {
    const module = await import('../src/util/log-lazy.ts');
    expect(module.lazyLog).toBeDefined();
    expect(typeof module.lazyLog).toBe('function');
  });

  it('should have all log level methods', async () => {
    const { lazyLog } = await import('../src/util/log-lazy.ts');

    expect(typeof lazyLog.error).toBe('function');
    expect(typeof lazyLog.warn).toBe('function');
    expect(typeof lazyLog.info).toBe('function');
    expect(typeof lazyLog.debug).toBe('function');
    expect(typeof lazyLog.verbose).toBe('function');
    expect(typeof lazyLog.trace).toBe('function');
  });

  it('should have level management methods', async () => {
    const { lazyLog } = await import('../src/util/log-lazy.ts');

    expect(typeof lazyLog.enableLevel).toBe('function');
    expect(typeof lazyLog.disableLevel).toBe('function');
    expect(typeof lazyLog.setLevel).toBe('function');
    expect(typeof lazyLog.getEnabledLevels).toBe('function');
    expect(typeof lazyLog.shouldLog).toBe('function');
  });

  it('should support tagging', async () => {
    const { lazyLog } = await import('../src/util/log-lazy.ts');

    expect(typeof lazyLog.tag).toBe('function');
    expect(typeof lazyLog.clone).toBe('function');

    // Should return self for chaining
    const result = lazyLog.tag('key', 'value');
    expect(result).toBe(lazyLog);
  });

  it('should export level presets', async () => {
    const { LEVEL_PRESETS } = await import('../src/util/log-lazy.ts');

    expect(LEVEL_PRESETS).toBeDefined();
    expect(LEVEL_PRESETS).toHaveProperty('disabled');
    expect(LEVEL_PRESETS).toHaveProperty('error');
    expect(LEVEL_PRESETS).toHaveProperty('warn');
    expect(LEVEL_PRESETS).toHaveProperty('info');
    expect(LEVEL_PRESETS).toHaveProperty('debug');
    expect(LEVEL_PRESETS).toHaveProperty('verbose');
    expect(LEVEL_PRESETS).toHaveProperty('trace');
    expect(LEVEL_PRESETS).toHaveProperty('production');
    expect(LEVEL_PRESETS).toHaveProperty('development');
  });

  it('should export syncLoggerWithVerboseFlag', async () => {
    const { syncLoggerWithVerboseFlag } =
      await import('../src/util/log-lazy.ts');
    expect(typeof syncLoggerWithVerboseFlag).toBe('function');
  });
});

describe('Lazy Logger Behavior', () => {
  it('should not execute callback when logging is disabled', async () => {
    const { createLazyLogger } = await import('../src/util/log-lazy.ts');

    let callbackExecuted = false;
    const logger = createLazyLogger();

    // Logger starts disabled by default (based on Flag.OPENCODE_VERBOSE)
    logger.info(() => {
      callbackExecuted = true;
      return { message: 'test' };
    });

    // Since verbose is not enabled, callback should not have been executed
    // Note: This depends on the Flag.OPENCODE_VERBOSE state which defaults to false
    expect(callbackExecuted).toBe(false);
  });

  it('should create logger with custom tags', async () => {
    const { createLazyLogger } = await import('../src/util/log-lazy.ts');

    const logger = createLazyLogger({
      service: 'custom-service',
      version: '1.0.0',
    });

    expect(logger).toBeDefined();
    expect(typeof logger).toBe('function');
  });
});
