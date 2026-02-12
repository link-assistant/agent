#!/usr/bin/env bun

// Experiment: Verify the process name fix works when the agent is spawned via bun run
// This simulates how the CI tests will verify it

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const srcDir = path.join(__dirname, '..', 'js', 'src');

// Create a minimal test script that applies the fix and reports its process name
const testScript = `
import { platform } from 'os';
import { dlopen, FFIType, ptr } from 'bun:ffi';
import fs from 'fs';

// Apply the fix (same as what we'll put in index.js)
process.title = 'agent';
process.argv0 = 'agent';

const os = platform();
if (os === 'linux') {
  try {
    const PR_SET_NAME = 15;
    const libc = dlopen('libc.so.6', {
      prctl: {
        args: [FFIType.i32, FFIType.ptr],
        returns: FFIType.i32,
      },
    });
    const buf = Buffer.from('agent\\0');
    libc.symbols.prctl(PR_SET_NAME, ptr(buf));
    libc.close();
  } catch (_e) {}
} else if (os === 'darwin') {
  try {
    const libc = dlopen('libSystem.B.dylib', {
      pthread_setname_np: {
        args: [FFIType.ptr],
        returns: FFIType.i32,
      },
    });
    const buf = Buffer.from('agent\\0');
    libc.symbols.pthread_setname_np(ptr(buf));
    libc.close();
  } catch (_e) {}
}

// Output the process comm name
if (os === 'linux') {
  const comm = fs.readFileSync('/proc/' + process.pid + '/comm', 'utf8').trim();
  console.log(comm);
} else if (os === 'darwin') {
  // On macOS, use ps to check the comm name
  const { execSync } = require('child_process');
  const ps = execSync('ps -p ' + process.pid + ' -o comm=').toString().trim();
  console.log(ps.split('/').pop()); // Get just the binary name
} else {
  console.log('unsupported');
}
`;

// Write the test script
const testScriptPath = path.join(__dirname, 'test-process-name-check.js');
fs.writeFileSync(testScriptPath, testScript);

try {
  // Run it
  const result = execSync(`bun ${testScriptPath}`).toString().trim();
  console.log('Process comm name:', result);
  console.log('Test result:', result === 'agent' ? 'PASS' : 'FAIL');
} finally {
  // Cleanup
  fs.unlinkSync(testScriptPath);
}
