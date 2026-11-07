// Run from the trusted workflow checkout before executing candidate code.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const sha = process.env.EXPECTED_SHA;
const eventSha = process.env.EVENT_SHA;
if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !/^[0-9a-f]{40}$/.test(eventSha ?? '')) {
  throw Error('Provenance requires immutable candidate and event revisions');
}
if (sha !== eventSha && process.env.PREREQUISITE_EVENT !== 'pull_request') {
  const branch = process.env.DEFAULT_BRANCH;
  if (!branch) throw Error('Default branch provenance is required for an alternative revision');
  execFileSync('git', ['check-ref-format', `refs/heads/${branch}`]);
  // The trusted bootstrap checkout fetches full remote history. Do not trust
  // membership in an arbitrary repository branch or a mutable release tag.
  const result = spawnSync('git', ['merge-base', '--is-ancestor', sha, `refs/remotes/origin/${branch}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Candidate is not in trusted default-branch history');
}
console.log(`Approved candidate provenance: ${sha}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `revision=${sha}\n`);
