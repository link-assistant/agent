#!/usr/bin/env bun
/**
 * Simulate how the solve command spawns the agent CLI
 * Check if HTTP verbose logs appear in the child process output
 */
import { spawn } from 'child_process';
import path from 'path';

const agentPath = path.resolve(import.meta.dir, '../js/src/index.js');
const promptFile = '/tmp/test_agent_prompt.txt';
await Bun.write(promptFile, 'hi');

console.log('Spawning agent...');
console.log(`Command: cat ${promptFile} | bun ${agentPath} --model opencode/minimax-m2.5-free --verbose --dry-run`);

const child = spawn('/bin/sh', ['-c', `cat "${promptFile}" | bun "${agentPath}" --model opencode/minimax-m2.5-free --verbose --dry-run`], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  const str = data.toString();
  stdout += str;
});

child.stderr.on('data', (data) => {
  const str = data.toString();
  stderr += str;
});

child.on('close', (code) => {
  console.log(`\nExit code: ${code}`);

  // Check for HTTP logs
  const httpRequestCount = (stdout.match(/HTTP request/g) || []).length;
  const httpResponseCount = (stdout.match(/HTTP response/g) || []).length;
  const verboseAtCreation = stdout.match(/verboseAtCreation[^,}]*/g) || [];
  const debugLogs = (stdout.match(/"level":\s*"debug"/g) || []).length;

  console.log(`\nStdout HTTP request logs: ${httpRequestCount}`);
  console.log(`Stdout HTTP response logs: ${httpResponseCount}`);
  console.log(`Stdout debug-level logs: ${debugLogs}`);
  console.log(`verboseAtCreation values: ${JSON.stringify(verboseAtCreation)}`);

  if (stderr) {
    const stderrHttpCount = (stderr.match(/HTTP/g) || []).length;
    console.log(`\nStderr HTTP mentions: ${stderrHttpCount}`);
    console.log(`Stderr (first 500 chars): ${stderr.slice(0, 500)}`);
  }

  if (httpRequestCount === 0) {
    console.log('\n*** BUG REPRODUCED: No HTTP request logs in verbose mode ***');
  } else {
    console.log('\n*** HTTP logs ARE present - bug NOT reproduced ***');
  }
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('Timeout - killing child');
  child.kill('SIGTERM');
}, 30000);
