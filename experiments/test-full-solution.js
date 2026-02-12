#!/usr/bin/env bun

// Experiment: Full cross-platform process naming solution
// Tests the complete approach that we'll use in the actual fix

import { platform } from 'os';

/**
 * Set the process name to 'agent' so it appears correctly in process monitoring tools
 * like top, ps, htop, Activity Monitor, etc.
 *
 * process.title only works in Node.js, not in Bun, so we use platform-specific
 * system calls via Bun's FFI:
 * - Linux: prctl(PR_SET_NAME, "agent") sets /proc/PID/comm
 * - macOS: pthread_setname_np("agent") sets the thread name (visible in Activity Monitor)
 * - Windows: Not supported (Windows Task Manager shows exe name)
 */
function setProcessName(name) {
  // Keep process.title for any tools that check it in-process
  process.title = name;
  process.argv0 = name;

  const os = platform();

  if (os === 'linux') {
    try {
      const { dlopen, FFIType, ptr } = require('bun:ffi');
      const PR_SET_NAME = 15;
      const libc = dlopen('libc.so.6', {
        prctl: {
          args: [FFIType.i32, FFIType.ptr],
          returns: FFIType.i32,
        },
      });
      const buf = Buffer.from(name.slice(0, 15) + '\0'); // PR_SET_NAME truncates to 16 bytes including null
      libc.symbols.prctl(PR_SET_NAME, ptr(buf));
      libc.close();
    } catch (_e) {
      // Silently fail - process name is cosmetic
    }
  } else if (os === 'darwin') {
    try {
      const { dlopen, FFIType, ptr } = require('bun:ffi');
      // On macOS, pthread_setname_np takes only the name (no thread param for current thread)
      const libc = dlopen('libSystem.B.dylib', {
        pthread_setname_np: {
          args: [FFIType.ptr],
          returns: FFIType.i32,
        },
      });
      const buf = Buffer.from(name.slice(0, 63) + '\0'); // macOS limit is 64 bytes including null
      libc.symbols.pthread_setname_np(ptr(buf));
      libc.close();
    } catch (_e) {
      // Silently fail - process name is cosmetic
    }
  }
  // Windows: No system call needed, Task Manager shows exe name
}

// Apply the fix
setProcessName('agent');

// Verify
const { execSync } = require('child_process');
const fs = require('fs');

console.log('Platform:', platform());
console.log('process.title:', process.title);
console.log('process.argv0:', process.argv0);
console.log('PID:', process.pid);

const psOutput = execSync(`ps -p ${process.pid} -o pid,comm,args 2>/dev/null || ps -p ${process.pid} 2>/dev/null`).toString();
console.log('\nps output:');
console.log(psOutput);

if (platform() === 'linux') {
  try {
    const comm = fs.readFileSync(`/proc/${process.pid}/comm`).toString().trim();
    console.log('/proc/PID/comm:', comm);
    console.log('SUCCESS:', comm === 'agent' ? 'YES' : 'NO');
  } catch (e) {
    console.log('Could not read /proc');
  }
}
