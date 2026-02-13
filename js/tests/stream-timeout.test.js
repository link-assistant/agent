import { test, expect, describe } from 'bun:test';
import { Flag } from '../src/flag/flag.ts';

describe('Stream timeout configuration', () => {
  describe('STREAM_CHUNK_TIMEOUT_MS', () => {
    test('returns default value of 120000 (2 minutes)', () => {
      // Save and clear env
      const saved = process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS;
      const savedNew = process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      delete process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS;
      delete process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;

      expect(Flag.STREAM_CHUNK_TIMEOUT_MS()).toBe(120_000);

      // Restore
      if (saved !== undefined) {
        process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS = saved;
      }
      if (savedNew !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = savedNew;
      }
    });

    test('reads from AGENT_STREAM_CHUNK_TIMEOUT_MS env var', () => {
      const saved = process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS;
      const savedNew = process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      delete process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS = '60000';

      expect(Flag.STREAM_CHUNK_TIMEOUT_MS()).toBe(60_000);

      // Restore
      if (saved !== undefined) {
        process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS = saved;
      } else {
        delete process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS;
      }
      if (savedNew !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = savedNew;
      }
    });

    test('LINK_ASSISTANT_AGENT prefix takes priority', () => {
      const saved = process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS;
      const savedNew = process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS = '60000';
      process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = '30000';

      expect(Flag.STREAM_CHUNK_TIMEOUT_MS()).toBe(30_000);

      // Restore
      if (saved !== undefined) {
        process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS = saved;
      } else {
        delete process.env.AGENT_STREAM_CHUNK_TIMEOUT_MS;
      }
      if (savedNew !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS = savedNew;
      } else {
        delete process.env.LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS;
      }
    });
  });

  describe('STREAM_STEP_TIMEOUT_MS', () => {
    test('returns default value of 600000 (10 minutes)', () => {
      const saved = process.env.AGENT_STREAM_STEP_TIMEOUT_MS;
      const savedNew = process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      delete process.env.AGENT_STREAM_STEP_TIMEOUT_MS;
      delete process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;

      expect(Flag.STREAM_STEP_TIMEOUT_MS()).toBe(600_000);

      if (saved !== undefined) {
        process.env.AGENT_STREAM_STEP_TIMEOUT_MS = saved;
      }
      if (savedNew !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = savedNew;
      }
    });

    test('reads from AGENT_STREAM_STEP_TIMEOUT_MS env var', () => {
      const saved = process.env.AGENT_STREAM_STEP_TIMEOUT_MS;
      const savedNew = process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      delete process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      process.env.AGENT_STREAM_STEP_TIMEOUT_MS = '300000';

      expect(Flag.STREAM_STEP_TIMEOUT_MS()).toBe(300_000);

      if (saved !== undefined) {
        process.env.AGENT_STREAM_STEP_TIMEOUT_MS = saved;
      } else {
        delete process.env.AGENT_STREAM_STEP_TIMEOUT_MS;
      }
      if (savedNew !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = savedNew;
      }
    });

    test('LINK_ASSISTANT_AGENT prefix takes priority', () => {
      const saved = process.env.AGENT_STREAM_STEP_TIMEOUT_MS;
      const savedNew = process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      process.env.AGENT_STREAM_STEP_TIMEOUT_MS = '300000';
      process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = '120000';

      expect(Flag.STREAM_STEP_TIMEOUT_MS()).toBe(120_000);

      if (saved !== undefined) {
        process.env.AGENT_STREAM_STEP_TIMEOUT_MS = saved;
      } else {
        delete process.env.AGENT_STREAM_STEP_TIMEOUT_MS;
      }
      if (savedNew !== undefined) {
        process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS = savedNew;
      } else {
        delete process.env.LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS;
      }
    });
  });
});
