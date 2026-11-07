import { describe, expect } from 'test-anywhere';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { itUnless, sandboxed } from './helpers/skip.js';

const script = resolve('scripts/check-release-needed.mjs');

async function probe({
  npmStatus = 200,
  githubStatus = 200,
  hasChangesets = false,
  jsRoot = '.',
  malformed = false,
  disconnect = false,
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-state-'));
  const requests = [];
  const tag = jsRoot === '.' ? 'v1.2.3' : 'js_v1.2.3';
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith('/repos/')) {
      if (disconnect) {
        request.socket.destroy();
        return;
      }
      response.writeHead(githubStatus, { 'content-type': 'application/json' });
      response.end(
        malformed ? '{}' : JSON.stringify({ id: 42, tag_name: tag })
      );
    } else {
      response.writeHead(npmStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ version: '1.2.3' }));
    }
  });
  try {
    mkdirSync(join(cwd, jsRoot), { recursive: true });
    writeFileSync(
      join(cwd, jsRoot, 'package.json'),
      '{"name":"fixture","version":"1.2.3"}'
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd,
        env: {
          ...process.env,
          JS_ROOT: jsRoot,
          HAS_CHANGESETS: String(hasChangesets),
          NPM_CONFIG_REGISTRY: url,
          GITHUB_API_URL: url,
          GITHUB_REPOSITORY: 'fixture/repo',
          GITHUB_OUTPUT: join(cwd, 'output'),
        },
      });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, output }));
    });
    return {
      ...result,
      outputs: readFileSync(join(cwd, 'output'), 'utf8'),
      requests,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('complete release gate (offline HTTP)', () => {
  itUnless(sandboxed)(
    'repairs a missing GitHub release for an npm-published version without bumping',
    async () => {
      const result = await probe({ githubStatus: 404 });
      expect(result.status).toBe(0);
      expect(result.outputs).toContain('should_release=true');
      expect(result.outputs).toContain('skip_bump=true');
      expect(
        result.requests.some(
          (path) => path === '/repos/fixture/repo/releases/tags/v1.2.3'
        )
      ).toBe(true);
    }
  );
  itUnless(sandboxed)(
    'does not release when both npm and GitHub already have the version',
    async () => {
      const result = await probe();
      expect(result.outputs).toContain('should_release=false');
      expect(result.outputs).toContain('skip_bump=false');
      expect(result.requests.length).toBe(2);
    }
  );
  itUnless(sandboxed)(
    'uses the same language-prefixed tag as release creation',
    async () => {
      const result = await probe({ githubStatus: 404, jsRoot: 'js' });
      expect(result.outputs).toContain('should_release=true');
      expect(result.requests.some((path) => path.endsWith('/js_v1.2.3'))).toBe(
        true
      );
    }
  );
  for (const githubStatus of [401, 403, 429, 500]) {
    itUnless(sandboxed)(
      `does not release on an unknown GitHub result (${githubStatus})`,
      async () => {
        const result = await probe({ githubStatus });
        expect(result.outputs).toContain('should_release=false');
        expect(result.output).toContain('unknown');
      }
    );
  }
  itUnless(sandboxed)(
    'does not release on a malformed GitHub response',
    async () => {
      const result = await probe({ malformed: true });
      expect(result.outputs).toContain('should_release=false');
      expect(result.output).toContain('unknown');
    }
  );
  itUnless(sandboxed)(
    'does not release on a GitHub network failure',
    async () => {
      const result = await probe({ disconnect: true });
      expect(result.outputs).toContain('should_release=false');
      expect(result.output).toContain('unknown');
    }
  );
  itUnless(sandboxed)(
    'still releases an unpublished npm version without bumping',
    async () => {
      const result = await probe({ npmStatus: 404 });
      expect(result.outputs).toContain('should_release=true');
      expect(result.outputs).toContain('skip_bump=true');
      expect(result.requests.length).toBe(1);
    }
  );
  itUnless(sandboxed)(
    'processes changesets without making remote lookups',
    async () => {
      const result = await probe({ hasChangesets: true });
      expect(result.outputs).toContain('should_release=true');
      expect(result.outputs).toContain('skip_bump=false');
      expect(result.requests.length).toBe(0);
    }
  );
});
