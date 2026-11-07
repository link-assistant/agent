#!/usr/bin/env node
/**
 * Bundle the Electron renderer (React + JSX) into a single
 * `electron/renderer/dist/bootstrap.js` file the renderer can load
 * under our strict CSP (`script-src 'self'`).
 *
 * The renderer process loads the bundle via a relative `<script type="module">`
 * tag in `index.html`, which keeps everything self-contained and avoids any
 * remote CDN. esbuild is invoked through the JS API so this works on every
 * platform without a global binary.
 */
import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const rendererDir = resolve(repoRoot, 'electron', 'renderer');
const distDir = resolve(rendererDir, 'dist');

const buildOptions = {
  entryPoints: [resolve(rendererDir, 'bootstrap.jsx')],
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  outfile: resolve(distDir, 'bootstrap.js'),
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  await mkdir(distDir, { recursive: true });
  if (process.argv.includes('--watch')) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('[build-renderer] watching for changes...');
    return;
  }
  await build(buildOptions);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
