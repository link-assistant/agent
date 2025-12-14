#!/usr/bin/env bun

/**
 * Build script to bundle the agent CLI with macros support
 *
 * This bundles the application so that macros are evaluated at build time
 * and their results are inlined into the bundle. This avoids the security
 * restriction that prevents macros from running in node_modules.
 */

const result = await Bun.build({
  entrypoints: ['./src/index.js'],
  outdir: './dist',
  target: 'bun',
  format: 'esm',
  minify: false,
  sourcemap: 'external',
  // Macros are enabled by default in Bun.build
  splitting: false, // Keep everything in one file for simplicity
  packages: 'bundle', // Bundle all dependencies
})

if (!result.success) {
  console.error('Build failed:')
  for (const message of result.logs) {
    console.error(message)
  }
  process.exit(1)
}

console.log('✓ Build successful!')
console.log(`  Generated ${result.outputs.length} output(s)`)
for (const output of result.outputs) {
  console.log(`  - ${output.path}`)
}
