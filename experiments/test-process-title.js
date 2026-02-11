#!/usr/bin/env bun

// Experiment: Test whether process.title works in Bun for top/ps
process.title = 'agent';
process.argv0 = 'agent';

console.log('process.title:', process.title);
console.log('process.argv0:', process.argv0);
console.log('process.pid:', process.pid);
console.log('');
console.log('Check what top/ps shows for this PID...');

// Keep the process alive for 10 seconds so we can check ps
const { execSync } = require('child_process');

// Check ourselves in ps
const psOutput = execSync(`ps -p ${process.pid} -o pid,comm,args 2>/dev/null || ps -p ${process.pid} 2>/dev/null`).toString();
console.log('\nps output for our PID:');
console.log(psOutput);

// Also check with /proc on Linux
try {
  const fs = require('fs');
  const cmdline = fs.readFileSync(`/proc/${process.pid}/cmdline`).toString().replace(/\0/g, ' ');
  const comm = fs.readFileSync(`/proc/${process.pid}/comm`).toString().trim();
  console.log('/proc/PID/cmdline:', cmdline);
  console.log('/proc/PID/comm:', comm);
} catch (e) {
  console.log('/proc not available (not Linux)');
}
