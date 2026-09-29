#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const pins = manifest.dependencyPins ?? {};
const result = spawnSync('npm', ['outdated', '--json', '--prefer-online'], {
  encoding: 'utf8',
});

if (result.error || (result.status !== 0 && result.status !== 1)) {
  process.stderr.write(result.stderr ?? '');
  throw result.error ?? new Error(`npm outdated exited ${result.status}`);
}

const outdated = JSON.parse(result.stdout || '{}');
const failures = [];

for (const [name, versions] of Object.entries(outdated)) {
  // npm outdated can report an older cached dist-tag after a package is
  // republished. Verify any apparent drift against the live registry tag.
  const live = spawnSync(
    'npm',
    ['view', name, 'dist-tags.latest', '--json', '--prefer-online'],
    {
      encoding: 'utf8',
    }
  );
  if (live.status !== 0) {
    failures.push(`${name}: could not verify the latest release`);
    continue;
  }
  const tag = JSON.parse(live.stdout.trim());
  const latest = Array.isArray(tag) ? tag.at(-1) : tag;
  if (versions.current === latest) {
    continue;
  }

  const issueUrl = pins[name];
  if (!issueUrl) {
    failures.push(`${name}: ${versions.current} -> ${latest}`);
    continue;
  }

  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(
    issueUrl
  );
  if (!match) {
    failures.push(`${name}: invalid issue URL ${issueUrl}`);
    continue;
  }

  const response = await fetch(
    `https://api.github.com/repos/${match[1]}/${match[2]}/issues/${match[3]}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    }
  );
  const issue = response.ok ? await response.json() : null;
  if (issue?.state !== 'open' || issue.pull_request) {
    failures.push(`${name}: pin issue is not open: ${issueUrl}`);
  } else {
    console.log(
      `${name}: pinned at ${versions.current}; latest ${latest} (${issueUrl})`
    );
  }
}

if (failures.length > 0) {
  console.error(`Dependencies behind latest:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('All unpinned npm dependencies are current.');
}
