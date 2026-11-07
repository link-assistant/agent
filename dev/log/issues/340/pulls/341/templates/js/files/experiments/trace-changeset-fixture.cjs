// Optional preload for diagnosing the real Changesets release fixture.
// Log commands and file writes, never the child's environment or file contents.
// Enable with DEBUG_CHANGESET_FIXTURE=1 and node --require this-file.cjs.
if (process.env.DEBUG_CHANGESET_FIXTURE) {
  const childProcess = require('node:child_process');
  const fs = require('node:fs');
  const { syncBuiltinESMExports } = require('node:module');
  const started = Date.now();
  const report = (operation, value) =>
    console.error(
      `[changeset fixture +${Date.now() - started}ms] ${operation}: ${JSON.stringify(value)}`
    );
  // Time between process start and this preload: slow runner startup.
  report('preload', {
    sinceProcessStartMs: Math.round(
      require('node:perf_hooks').performance.now()
    ),
  });
  for (const method of ['spawn', 'execFile']) {
    const original = childProcess[method];
    childProcess[method] = function (command, args, ...rest) {
      report(method, { command, args });
      const child = original.call(this, command, args, ...rest);
      child.on('exit', (code, signal) =>
        report('exit', { command, code, signal })
      );
      // Formatter failures are otherwise swallowed by the parent's pipe.
      for (const stream of ['stdout', 'stderr']) {
        child[stream]?.on('data', (data) =>
          report(stream, { command, data: String(data) })
        );
      }
      child.on('error', (error) =>
        report('error', { command, message: error.message })
      );
      return child;
    };
  }
  for (const method of ['writeFile', 'readFile']) {
    const original = fs.promises[method];
    fs.promises[method] = async function (file, ...args) {
      report(method, String(file));
      return await original.call(this, file, ...args);
    };
  }
  syncBuiltinESMExports();
}
