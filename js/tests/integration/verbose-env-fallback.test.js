import { test, expect, setDefaultTimeout, describe } from 'bun:test';
import { spawn } from 'child_process';
import path from 'path';

// Increase default timeout to 120 seconds — real API calls may take longer
setDefaultTimeout(120000);

/**
 * Integration tests for verbose mode env var fallback.
 *
 * Verifies that verbose HTTP logging works when enabled via:
 * 1. CLI --verbose flag (existing behavior)
 * 2. LINK_ASSISTANT_AGENT_VERBOSE=true env var (fallback for subprocess scenarios)
 *
 * This addresses issue #227 where --verbose logging was silently lost when
 * the agent CLI was spawned by external tools (command-stream, solve).
 *
 * @see https://github.com/link-assistant/agent/issues/227
 */

/**
 * Helper to spawn the agent CLI with custom env and collect output.
 */
function spawnAgent(args, env = {}) {
  return new Promise((resolve) => {
    const projectRoot = process.cwd();
    const agentPath = path.join(projectRoot, 'src', 'index.js');
    const input = '{"message":"hi"}';

    const child = spawn(
      '/bin/sh',
      ['-c', `echo '${input}' | bun "${agentPath}" ${args}`],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, combined: `${stdout}\n${stderr}`, code });
    });

    // Timeout
    setTimeout(() => child.kill('SIGTERM'), 25000);
  });
}

describe('Verbose mode env var fallback (#227)', () => {
  test('--verbose flag produces HTTP logs (baseline)', async () => {
    const result = await spawnAgent('--verbose --dry-run');

    // Must contain HTTP request/response logs
    const hasHttpRequest =
      result.combined.includes('"message": "HTTP request"') ||
      result.combined.includes('"message":"HTTP request"');
    expect(hasHttpRequest).toBe(true);

    // Must contain debug-level logs (proving verbose is fully active)
    const hasDebug =
      result.combined.includes('"level": "debug"') ||
      result.combined.includes('"level":"debug"');
    expect(hasDebug).toBe(true);

    console.log('✅ --verbose flag produces HTTP logs');
  });

  test('LINK_ASSISTANT_AGENT_VERBOSE=true env var enables HTTP logs', async () => {
    // Run WITHOUT --verbose flag but WITH env var
    const result = await spawnAgent('--dry-run', {
      LINK_ASSISTANT_AGENT_VERBOSE: 'true',
    });

    // Must contain HTTP request/response logs from env var activation
    const hasHttpRequest =
      result.combined.includes('"message": "HTTP request"') ||
      result.combined.includes('"message":"HTTP request"');
    expect(hasHttpRequest).toBe(true);

    console.log(
      '✅ LINK_ASSISTANT_AGENT_VERBOSE=true env var enables HTTP logs'
    );
  });

  test('without --verbose or env var, no HTTP logs appear', async () => {
    const result = await spawnAgent('--dry-run');

    // Must NOT contain HTTP request logs
    const hasHttpRequest =
      result.combined.includes('"message": "HTTP request"') ||
      result.combined.includes('"message":"HTTP request"');
    expect(hasHttpRequest).toBe(false);

    // Must NOT contain debug-level logs
    const hasDebug =
      result.combined.includes('"level": "debug"') ||
      result.combined.includes('"level":"debug"');
    expect(hasDebug).toBe(false);

    console.log('✅ No HTTP logs without --verbose or env var');
  });

  test('subprocess inherits verbose env var from --verbose flag', async () => {
    const result = await spawnAgent('--verbose --dry-run');

    // Check that verboseAtCreation is true (env var propagation working)
    const hasVerboseAtCreation =
      result.combined.includes('"verboseAtCreation": true') ||
      result.combined.includes('"verboseAtCreation":true');
    expect(hasVerboseAtCreation).toBe(true);

    console.log('✅ subprocess shows verboseAtCreation: true');
  });
});
