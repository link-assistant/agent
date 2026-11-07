import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveBasePath() {
  if (process.env.GITHUB_PAGES !== 'true') {
    return './';
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
  return repository ? `/${repository}/` : './';
}

export default defineConfig({
  base: resolveBasePath(),
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
});
