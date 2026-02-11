#!/usr/bin/env bun

// Experiment: Test using exec to re-launch with a custom process name
// On Linux, we can use exec -a to set argv[0]

const { execSync } = require('child_process');

// Check if we're already running as 'agent' (via exec -a)
const isRenamed = process.env.__AGENT_RENAMED === '1';

if (!isRenamed) {
  console.log('Not renamed yet. Testing exec -a approach...');

  // Get the path to this script
  const scriptPath = process.argv[1];
  const bunPath = process.argv[0];

  console.log('bunPath:', bunPath);
  console.log('scriptPath:', scriptPath);

  // Try exec -a to set the process name
  try {
    const result = execSync(
      `__AGENT_RENAMED=1 exec -a agent bun "${scriptPath}" 2>&1 || echo "exec -a failed"`,
      { env: { ...process.env, __AGENT_RENAMED: '1' } }
    ).toString();
    console.log('Result:', result);
  } catch (e) {
    console.log('exec -a approach failed:', e.message);
  }
} else {
  console.log('Running as renamed process!');
  console.log('process.pid:', process.pid);

  // Check ourselves in ps
  const psOutput = execSync(`ps -p ${process.pid} -o pid,comm,args 2>/dev/null || ps -p ${process.pid} 2>/dev/null`).toString();
  console.log('\nps output:');
  console.log(psOutput);

  try {
    const fs = require('fs');
    const comm = fs.readFileSync(`/proc/${process.pid}/comm`).toString().trim();
    const cmdline = fs.readFileSync(`/proc/${process.pid}/cmdline`).toString().replace(/\0/g, ' ');
    console.log('/proc/PID/comm:', comm);
    console.log('/proc/PID/cmdline:', cmdline);
  } catch (e) {
    console.log('/proc not available');
  }
}
