#!/usr/bin/env bun

// Experiment: Test using prctl(PR_SET_NAME) via Bun FFI to set process name
// On Linux, prctl(PR_SET_NAME, name) sets the process comm name (shown in top/ps)

import { dlopen, FFIType, suffix, ptr, CString } from 'bun:ffi';

const PR_SET_NAME = 15;

try {
  // Open libc
  const libc = dlopen(`libc.so.6`, {
    prctl: {
      args: [FFIType.i32, FFIType.ptr],
      returns: FFIType.i32,
    },
  });

  // Create the name buffer
  const name = Buffer.from('agent\0');
  const result = libc.symbols.prctl(PR_SET_NAME, ptr(name));
  console.log('prctl result:', result, '(0 = success)');

  // Check ourselves in ps
  const { execSync } = require('child_process');
  const fs = require('fs');

  const psOutput = execSync(`ps -p ${process.pid} -o pid,comm,args`).toString();
  console.log('\nps output:');
  console.log(psOutput);

  const comm = fs.readFileSync(`/proc/${process.pid}/comm`).toString().trim();
  const cmdline = fs.readFileSync(`/proc/${process.pid}/cmdline`).toString().replace(/\0/g, ' ');
  console.log('/proc/PID/comm:', comm);
  console.log('/proc/PID/cmdline:', cmdline);

  libc.close();
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
}
