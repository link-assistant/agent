#!/usr/bin/env bun

const { execSync } = require('child_process');
const fs = require('fs');

console.log('PID:', process.pid);
console.log('process.argv[0]:', process.argv[0]);

// Check ourselves in ps
const psOutput = execSync(`ps -p ${process.pid} -o pid,comm,args`).toString();
console.log('\nps output:');
console.log(psOutput);

try {
  const comm = fs.readFileSync(`/proc/${process.pid}/comm`).toString().trim();
  const cmdline = fs.readFileSync(`/proc/${process.pid}/cmdline`).toString().replace(/\0/g, ' ');
  console.log('/proc/PID/comm:', comm);
  console.log('/proc/PID/cmdline:', cmdline);
} catch (e) {
  console.log('/proc not available');
}
