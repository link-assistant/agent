#!/usr/bin/env node
// A valid, length-prefixed publish metadata request with NO archive length or
// archive bytes. crates.io authenticates/scopes it before reading that length;
// reaching exactly that error proves token scope without publishing a version.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function publishProbeBody(packageName) {
  const metadata = Buffer.from(JSON.stringify({ name: packageName, vers: '0.0.0-preflight' }));
  const body = Buffer.alloc(4 + metadata.length);
  body.writeUInt32LE(metadata.length);
  metadata.copy(body, 4);
  return body;
}

export async function checkCratePublisher({ packageName, token, api = 'https://crates.io',
  fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  if (!packageName || !token) {
    return { verdict: 'denied', message: 'missing crate name or publish credential' };
  }
  try {
    const response = await fetchImpl(`${api}/api/v1/crates/new`, {
      method: 'PUT',
      headers: { authorization: token, 'content-type': 'application/octet-stream',
        'user-agent': 'release-preflight (rust-ai-driven-development-pipeline-template)' },
      body: publishProbeBody(packageName),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 400) {
      const result = await response.json();
      if (result.errors?.length === 1 && result.errors[0].detail === 'invalid tarball length') {
        return { verdict: 'verified', message: 'publish token and crate scope accepted; archive omitted (ownership is checked by the real publish)' };
      }
    }
    if (response.status === 401 || response.status === 403) {
      return { verdict: 'denied', message: `publish token or crate scope rejected (${response.status})` };
    }
    return { verdict: 'unknown', message: `publish probe returned HTTP ${response.status} without the exact missing-archive confirmation` };
  } catch {
    // Remote bodies/errors may echo secrets. Log only our own fixed messages.
    return { verdict: 'unknown', message: 'publish probe unreachable or returned an invalid response' };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await checkCratePublisher({ packageName: process.argv[2],
    token: process.env.CARGO_REGISTRY_TOKEN || process.env.CARGO_TOKEN,
    api: process.env.CRATES_API || 'https://crates.io',
    timeoutMs: Number(process.env.PREFLIGHT_CURL_TIMEOUT || 15) * 1000 });
  console.log(result.message);
  process.exitCode = { verified: 0, denied: 1, unknown: 2 }[result.verdict];
}
