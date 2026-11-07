import { describe, it, expect } from 'test-anywhere';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itUnless, sandboxed, noPosixShell } from './helpers/skip.js';

const ACTION_PATH = '.github/actions/setup-buildx-resilient/action.yml';
const action = readFileSync(ACTION_PATH, 'utf8');

// Extract the first `run: |` block verbatim from the action so the test drives
// the real pre-pull script (not a copy that can drift out of sync). The block
// starts after the first `run: |` line and ends at the next step (`    - name:`
// at 4-space indent). The body is dedented by its own indentation.
function extractPrepullScript(yaml) {
  const lines = yaml.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  if (start === -1) {
    throw new Error("could not find 'run: |' in action.yml");
  }

  const body = [];
  let indent = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}- name:/.test(line)) {
      break;
    }
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (indent === null) {
      indent = line.match(/^\s*/)[0].length;
    }
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

// A mock `docker` CLI placed on PATH. CANONICAL_OK / MIRROR_OK env fixtures
// decide whether each source serves pulls. It records calls/pulls/tags so the
// test can assert exactly which registry the script reached for.
const MOCK_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$DOCKER_CALLS"
case "$1" in
  pull)
    ref="$2"
    case "$ref" in
      mirror.gcr.io/*)
        [ "\${MIRROR_OK:-0}" = "1" ] && { echo "$ref" >> "$DOCKER_PULLED"; exit 0; }
        echo 'Error response from daemon: Get "https://mirror.gcr.io/v2/": timeout' >&2
        exit 1 ;;
      *)
        [ "\${CANONICAL_OK:-0}" = "1" ] && { echo "$ref" >> "$DOCKER_PULLED"; exit 0; }
        echo 'Error response from daemon: Get "https://registry-1.docker.io/v2/": timeout' >&2
        exit 1 ;;
    esac ;;
  tag)
    echo "tag $2 $3" >> "$DOCKER_TAGGED"; exit 0 ;;
  *) exit 0 ;;
esac
`;

function runCase({ canonicalOk, mirrorOk }) {
  const work = mkdtempSync(join(tmpdir(), 'buildx-resilient-'));
  const bin = join(work, 'bin');
  execFileSync('mkdir', ['-p', bin]);

  const scriptPath = join(work, 'prepull.sh');
  writeFileSync(scriptPath, extractPrepullScript(action));

  const dockerPath = join(bin, 'docker');
  writeFileSync(dockerPath, MOCK_DOCKER);
  chmodSync(dockerPath, 0o755);

  const calls = join(work, 'calls');
  const pulled = join(work, 'pulled');
  const tagged = join(work, 'tagged');
  for (const file of [calls, pulled, tagged]) {
    writeFileSync(file, '');
  }

  let status = 0;
  let output;
  try {
    output = execFileSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BUILDKIT_IMAGE: 'moby/buildkit:buildx-stable-1',
        REGISTRY_MIRROR: 'mirror.gcr.io',
        VERBOSE: 'false',
        PREPULL_ATTEMPTS: '2',
        PREPULL_DELAY: '1',
        CANONICAL_OK: canonicalOk ? '1' : '0',
        MIRROR_OK: mirrorOk ? '1' : '0',
        DOCKER_CALLS: calls,
        DOCKER_PULLED: pulled,
        DOCKER_TAGGED: tagged,
      },
    });
  } catch (error) {
    status = error.status ?? 1;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  return {
    status,
    output,
    calls: readFileSync(calls, 'utf8'),
    pulled: readFileSync(pulled, 'utf8'),
    tagged: readFileSync(tagged, 'utf8'),
  };
}

describe('setup-buildx-resilient pre-pull script', () => {
  itUnless(sandboxed, noPosixShell)(
    'caches the canonical image and never touches the mirror when Docker Hub is healthy',
    () => {
      const result = runCase({ canonicalOk: true, mirrorOk: false });

      expect(result.status).toBe(0);
      expect(result.pulled).toContain('moby/buildkit:buildx-stable-1');
      expect(result.calls).not.toContain('mirror.gcr.io');
      expect(result.tagged.trim()).toBe('');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'recovers via the mirror and re-tags to canonical when Docker Hub is down',
    () => {
      const result = runCase({ canonicalOk: false, mirrorOk: true });

      expect(result.status).toBe(0);
      expect(result.pulled).toContain(
        'mirror.gcr.io/moby/buildkit:buildx-stable-1'
      );
      expect(result.tagged).toContain(
        'tag mirror.gcr.io/moby/buildkit:buildx-stable-1 moby/buildkit:buildx-stable-1'
      );
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'falls through non-fatally when both the registry and the mirror are down',
    () => {
      const result = runCase({ canonicalOk: false, mirrorOk: false });

      // Non-fatal by design: the step still exits 0 so the buildx boot can try
      // its own pull, preserving the previous worst-case behaviour.
      expect(result.status).toBe(0);
      expect(result.calls).toContain('mirror.gcr.io');
      expect(result.output).toContain('could not pre-pull');
    }
  );
});

describe('setup-buildx-resilient action.yml', () => {
  it('declares the mirror fallback and pins the boot driver image', () => {
    expect(action).toContain('registry-mirror:');
    expect(action).toContain("default: 'mirror.gcr.io'");
    expect(action).toContain('driver-opts: image=${{ inputs.buildkit-image }}');
  });

  it('supports verbose tracing and honours RUNNER_DEBUG', () => {
    expect(action).toContain('set -x');
    expect(action).toContain('RUNNER_DEBUG');
  });
});
