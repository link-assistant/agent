#!/usr/bin/env node
// Credential probes discard tokens and never upload an archive or create a tag.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCrateInfo } from './rust-package-info.mjs';

export async function preflight(target, env = process.env, fetchFn = fetch) {
  const request = (url, options = {}) =>
    fetchFn(url, {
      ...options,
      signal: globalThis.AbortSignal.timeout(15000),
    });
  try {
    if (target === 'npm') {
      if (
        !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
        !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
      ) {
        return {
          verdict: 'denied',
          message:
            'npm publishing needs id-token: write and a trusted publisher for js.yml on npmjs.com.',
        };
      }
      const url = new globalThis.URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
      url.searchParams.set('audience', 'npm:registry.npmjs.org');
      const jwtResponse = await request(url, {
        headers: {
          Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
        },
      });
      if (!jwtResponse.ok) {
        return {
          verdict: 'unknown',
          message: `npm OIDC request returned HTTP ${jwtResponse.status}.`,
        };
      }
      const jwt = (await jwtResponse.json()).value;
      if (typeof jwt !== 'string' || !jwt) {
        throw new Error('invalid JWT');
      }
      const { name } = JSON.parse(
        readFileSync(
          new globalThis.URL('../js/package.json', import.meta.url),
          'utf8'
        )
      );
      const response = await request(
        `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
        }
      );
      const exchanged = response.ok ? await response.json() : {};
      if (typeof exchanged.token === 'string' && exchanged.token.length > 0) {
        return {
          verdict: 'verified',
          message:
            'npm package-scoped OIDC exchange verified; token discarded.',
        };
      }
      return {
        verdict: [401, 403, 404].includes(response.status)
          ? 'denied'
          : 'unknown',
        message: `npm package exchange returned HTTP ${response.status}. Configure the trusted publisher for this repository and js.yml in npm package settings.`,
      };
    }
    if (target !== 'crates') {
      throw new Error('unknown target');
    }
    const token = env.CARGO_REGISTRY_TOKEN || env.CARGO_TOKEN;
    if (!token) {
      return {
        verdict: 'denied',
        message:
          'Configure crates.io trusted publishing for rust.yml or a CARGO_REGISTRY_TOKEN/CARGO_TOKEN secret with publish scope.',
      };
    }
    const { name } = parseCrateInfo(
      readFileSync(
        new globalThis.URL('../rust/Cargo.toml', import.meta.url),
        'utf8'
      )
    );
    const metadata = Buffer.from(
      JSON.stringify({ name, vers: '0.0.0-preflight' })
    );
    const body = Buffer.alloc(4 + metadata.length);
    body.writeUInt32LE(metadata.length);
    metadata.copy(body, 4);
    const response = await request('https://crates.io/api/v1/crates/new', {
      method: 'PUT',
      body,
      headers: {
        authorization: token,
        'content-type': 'application/octet-stream',
        'user-agent': 'link-assistant-agent-release-preflight',
      },
    });
    if (response.status === 400) {
      const result = await response.json();
      if (
        result.errors?.length === 1 &&
        result.errors[0].detail === 'invalid tarball length'
      ) {
        return {
          verdict: 'verified',
          message:
            'crates.io publish credential and scope accepted; archive omitted. Ownership is checked by cargo publish.',
        };
      }
    }
    return {
      verdict: [401, 403].includes(response.status) ? 'denied' : 'unknown',
      message: `crates.io publish probe returned HTTP ${response.status}; check token publish scope and crate ownership.`,
    };
  } catch {
    // Do not echo remote bodies or exceptions: either can include credentials.
    return {
      verdict: 'unknown',
      message: `${target} credential probe unreachable or malformed; publishing remains unverified.`,
    };
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const target = process.argv[2];
  if (!['npm', 'crates'].includes(target)) {
    throw new Error('Usage: release-preflight.mjs npm|crates');
  }
  const release = process.env.PREFLIGHT_MODE === 'release';
  if (!release) {
    console.log(
      '::notice::Release credential verification is deferred to main. Pull requests do not publish or require release secrets.'
    );
  } else {
    const result = await preflight(target);
    console.log(
      `${result.verdict === 'verified' ? '' : '::error::'}${result.message}`
    );
    process.exitCode = result.verdict === 'verified' ? 0 : 1;
  }
}
