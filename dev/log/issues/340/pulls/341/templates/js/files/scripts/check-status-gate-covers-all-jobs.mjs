#!/usr/bin/env node

/**
 * Fails when a job in a workflow is missing from the terminal status job's
 * `needs`, i.e. when its failure cannot turn the run red.
 *
 * `pipeline-status` is the job a branch protection rule keys on: it runs
 * `if: !cancelled()`, `needs:` every other job, and turns any failure among
 * them into a red run. Its `needs` list is hand-maintained, so a job left
 * out of it can fail while the gate reports success. This script derives
 * the requirement from the workflow itself, so the gate cannot drift from
 * the job list it is supposed to cover.
 *
 * Usage:
 *   node scripts/check-status-gate-covers-all-jobs.mjs <workflow.yml>...
 *   node scripts/check-status-gate-covers-all-jobs.mjs --gate <name> <workflow.yml>...
 *
 * Exit codes:
 *   0 = every gate covers every other job in its workflow
 *   1 = a gate has a hole: a job's failure cannot fail the run
 *   2 = the check could not run (no gate job, unreadable file, bad usage)
 */

import { readFileSync } from 'node:fs';

function listJobs(workflowText) {
  const jobsStart = workflowText.indexOf('\njobs:\n');

  if (jobsStart === -1) {
    return [];
  }

  const jobsBody = workflowText.slice(jobsStart);

  return Array.from(
    jobsBody.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm),
    (match) => match[1]
  );
}

function getJobBlock(workflowText, jobName) {
  const lines = workflowText.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

// `needs` accepts both the flow form (`needs: [a, b]`) and the block form
// (one `- name` list item per line); the shipped workflows use the block.
function listNeededJobs(jobBlock) {
  const flow = jobBlock.match(/^ {4}needs:\s*\[(.+)\]\s*$/m);

  if (flow) {
    return flow[1]
      .split(',')
      .map((job) => job.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const lines = jobBlock.split('\n');
  const needsStart = lines.findIndex((line) => line === '    needs:');

  if (needsStart === -1) {
    return [];
  }

  const neededJobs = [];

  for (const line of lines.slice(needsStart + 1)) {
    const content = line.replace(/\s+#.*$/, '');
    if (!content.trim() || content.trimStart().startsWith('#')) {
      continue;
    }
    const item = content.match(/^ {6}- ([a-zA-Z0-9_-]+)\s*$/);

    if (!item) {
      break;
    }

    neededJobs.push(item[1]);
  }

  return neededJobs;
}

function main() {
  const args = process.argv.slice(2);
  const gateIndex = args.indexOf('--gate');
  const gateName =
    gateIndex !== -1 ? (args[gateIndex + 1] ?? '') : 'pipeline-status';

  if (!gateName) {
    console.error('::error::--gate requires a job name');
    process.exit(2);
  }

  const files = args.filter(
    (arg, index) =>
      arg !== '--gate' && (gateIndex === -1 || index !== gateIndex + 1)
  );

  if (files.length === 0) {
    console.error(
      'Usage: node scripts/check-status-gate-covers-all-jobs.mjs [--gate <name>] <workflow.yml>...'
    );
    process.exit(2);
  }

  let holes = false;
  let broken = false;

  for (const file of files) {
    let workflowText;

    try {
      // Normalise line endings: a Windows checkout stores CRLF, and the
      // job-block matcher below compares whole lines.
      workflowText = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    } catch (error) {
      console.error(
        `::error file=${file}::cannot read workflow: ${error.message}`
      );
      broken = true;
      continue;
    }

    const jobs = listJobs(workflowText);

    if (jobs.length === 0) {
      console.error(`::error file=${file}::no jobs found`);
      broken = true;
      continue;
    }

    const gateBlock = getJobBlock(workflowText, gateName);

    if (!gateBlock) {
      console.error(
        `::error file=${file}::no '${gateName}' job: this workflow has no terminal status gate`
      );
      broken = true;
      continue;
    }

    const neededJobs = listNeededJobs(gateBlock);
    const missingJobs = jobs.filter(
      (job) => job !== gateName && !neededJobs.includes(job)
    );

    if (missingJobs.length > 0) {
      holes = true;

      for (const job of missingJobs) {
        console.error(
          `::error file=${file}::job '${job}' is not in ${gateName}.needs; its failure cannot fail the run`
        );
      }

      continue;
    }

    console.log(
      `${file}: ${gateName} covers all ${jobs.length - 1} other job(s).`
    );
  }

  // Exit 1 ("the gate has a hole") and exit 2 ("the gate is missing or the
  // check could not run") name different fixes; a hole wins when both
  // appear because the holes are the actionable findings.
  if (holes) {
    process.exit(1);
  }

  if (broken) {
    process.exit(2);
  }

  process.exit(0);
}

main();
