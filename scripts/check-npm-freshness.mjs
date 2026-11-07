#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportFreshness } from './freshness-policy.mjs';

function npm(args) {
  const result = spawnSync('npm', [...args, '--json', '--prefer-online'], {
    encoding: 'utf8',
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw (
      result.error ||
      new Error(
        `npm ${args[0]} failed (${result.signal || result.status}): ${result.stderr}`
      )
    );
  }
  const value = JSON.parse(result.stdout || '{}');
  if (value.error) {
    throw new Error(
      `npm ${args[0]} failed: ${value.error.summary || value.error.code}`
    );
  }
  return value;
}

export async function npmFindings(
  manifest,
  outdated,
  latestVersion,
  fetchIssue
) {
  const failures = [];
  for (const [name, versions] of Object.entries(outdated)) {
    // Verify apparent drift against the live tag; stale npm metadata used to
    // report a package already at the latest version as outdated (#337).
    const latest = await latestVersion(name);
    if (typeof latest !== 'string' || !latest) {
      throw new Error(`${name}: invalid latest dist-tag`);
    }
    if (versions.current === latest) {
      continue;
    }
    const issueUrl = manifest.dependencyPins?.[name];
    if (!issueUrl) {
      failures.push(
        `${name}: ${versions.current || 'not installed'} -> ${latest}`
      );
      continue;
    }
    const match =
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(issueUrl);
    if (!match) {
      failures.push(`${name}: invalid issue URL ${issueUrl}`);
      continue;
    }
    const response = await fetchIssue(
      `https://api.github.com/repos/${match[1]}/${match[2]}/issues/${match[3]}`
    );
    if (!response.ok) {
      throw new Error(
        `${name}: pin issue verification unavailable (HTTP ${response.status}): ${issueUrl}`
      );
    }
    const issue = await response.json();
    if (issue?.state !== 'open' || issue.pull_request) {
      failures.push(`${name}: pin issue is not open: ${issueUrl}`);
    } else {
      console.log(
        `${name}: pinned at ${versions.current}; latest ${latest} (${issueUrl})`
      );
    }
  }
  return failures;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const failures = await npmFindings(
    JSON.parse(readFileSync('package.json', 'utf8')),
    npm(['outdated']),
    (name) => {
      const tag = npm(['view', name, 'dist-tags.latest']);
      return Array.isArray(tag) ? tag.at(-1) : tag;
    },
    (url) =>
      fetch(url, {
        signal: globalThis.AbortSignal.timeout(30000),
        headers: {
          Accept: 'application/vnd.github+json',
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      })
  );
  process.exitCode = reportFreshness(failures);
  if (failures.length === 0) {
    console.log('All unpinned npm dependencies are current.');
  }
}
