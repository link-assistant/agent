import { test, expect, describe } from 'bun:test';
import { config, resetConfig } from '../../src/flag/agent-config.ts';

describe('Stream timeout configuration', () => {
  describe('STREAM_CHUNK_TIMEOUT_MS', () => {
    test('returns default value of 120000 (2 minutes)', () => {
      const saved = process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      delete process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      resetConfig();

      expect(config.streamChunkTimeoutMs).toBe(120_000);

      if (saved !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = saved;
      }
      resetConfig();
    });

    test('reads from LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS env var', () => {
      const saved = process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = '60000';
      resetConfig();

      expect(config.streamChunkTimeoutMs).toBe(60_000);

      if (saved !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = saved;
      } else {
        delete process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      }
      resetConfig();
    });
  });

  describe('STREAM_STEP_TIMEOUT_MS', () => {
    test('returns default value of 600000 (10 minutes)', () => {
      const saved = process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      delete process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      resetConfig();

      expect(config.streamStepTimeoutMs).toBe(600_000);

      if (saved !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = saved;
      }
      resetConfig();
    });

    test('reads from LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS env var', () => {
      const saved = process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = '300000';
      resetConfig();

      expect(config.streamStepTimeoutMs).toBe(300_000);

      if (saved !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = saved;
      } else {
        delete process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      }
      resetConfig();
    });
  });
});
