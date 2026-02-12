#!/usr/bin/env bun

// Experiment: Cross-platform process name setting
// Linux: prctl(PR_SET_NAME)
// macOS: No reliable way to change comm from userspace, but process.title might work differently

import { platform } from 'os';

console.log('Platform:', platform());

if (platform() === 'linux') {
  try {
    const { dlopen, FFIType, ptr } = await import('bun:ffi');
    const PR_SET_NAME = 15;

    const libc = dlopen('libc.so.6', {
      prctl: {
        args: [FFIType.i32, FFIType.ptr],
        returns: FFIType.i32,
      },
    });

    const name = Buffer.from('agent\0');
    const result = libc.symbols.prctl(PR_SET_NAME, ptr(name));
    console.log('prctl result:', result);
    libc.close();
  } catch (e) {
    console.error('Linux prctl failed:', e.message);
  }
} else if (platform() === 'darwin') {
  try {
    const { dlopen, FFIType, ptr } = await import('bun:ffi');

    // On macOS, we can try pthread_setname_np
    const libc = dlopen('libSystem.B.dylib', {
      pthread_self: {
        args: [],
        returns: FFIType.ptr,
      },
      pthread_setname_np: {
        args: [FFIType.ptr],
        returns: FFIType.i32,
      },
    });

    const name = Buffer.from('agent\0');
    const result = libc.symbols.pthread_setname_np(ptr(name));
    console.log('pthread_setname_np result:', result);
    libc.close();
  } catch (e) {
    console.error('macOS pthread_setname_np failed:', e.message);
  }
}

// Verify
const { execSync } = require('child_process');
const psOutput = execSync(`ps -p ${process.pid} -o pid,comm,args`).toString();
console.log('\nps output:');
console.log(psOutput);
