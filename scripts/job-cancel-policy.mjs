#!/usr/bin/env node

/**
 * Tell which jobs of a workflow a newer run may cancel (`cancel-in-progress`).
 *
 * scripts/check-pipeline-status.sh accepts a cancelled job only when a newer
 * run superseded this one AND the job's own concurrency lets a newer run
 * cancel it. Every other cancellation, such as `timeout-minutes` killing a
 * test on a pull request, is a failure the gate must not hide (issue #337).
 *
 * The jobs of this repository write `cancel-in-progress` as the expression
 * `${{ github.ref != 'refs/heads/main' }}`, so it is evaluated against
 * GITHUB_REF. Any other expression is "unknown", which never excuses a
 * cancellation.
 *
 * CLI (prints the given jobs that a newer run may cancel, one per line):
 *   WORKFLOW_FILE=.github/workflows/js.yml GITHUB_REF=refs/pull/1/merge \
 *     node scripts/job-cancel-policy.mjs test lint
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JOB_KEY = /^ {2}([a-zA-Z0-9_-]+):\s*(#.*)?$/;

function blockAfter(lines, start, indent) {
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      line.trim() !== '' &&
      !line.trimStart().startsWith('#') &&
      line.length - line.trimStart().length <= indent
  );
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function readCancelInProgress(lines, indent) {
  const pattern = new RegExp(`^ {${indent}}cancel-in-progress:\\s*(.+?)\\s*$`);
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      return match[1].replace(/\s+#.*$/, '');
    }
  }
  return 'false';
}

/**
 * Read the raw `cancel-in-progress` value that governs one job: the job's own
 * `concurrency`, else the workflow-level one.
 * @param {string} body - workflow YAML
 * @param {string} jobId
 * @returns {string} the raw value, 'none' without any concurrency group, or
 *   'missing' when the workflow has no such job
 */
export function readJobCancelInProgress(body, jobId) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const jobsStart = lines.indexOf('jobs:');
  const jobStart = lines.findIndex(
    (line, index) => index > jobsStart && line.match(JOB_KEY)?.[1] === jobId
  );
  if (jobsStart === -1 || jobStart === -1) {
    return 'missing';
  }

  const jobLines = blockAfter(lines, jobStart, 2);
  const jobConcurrency = jobLines.findIndex((line) =>
    /^ {4}concurrency:/.test(line)
  );
  if (jobConcurrency !== -1) {
    const inline = jobLines[jobConcurrency].match(
      /^ {4}concurrency:\s*(\S.*)$/
    );
    // A string group (`concurrency: name`) never cancels in progress.
    return inline && !inline[1].startsWith('#')
      ? 'false'
      : readCancelInProgress(blockAfter(jobLines, jobConcurrency, 4), 6);
  }

  const workflowConcurrency = lines.findIndex(
    (line, index) => index < jobsStart && /^concurrency:/.test(line)
  );
  if (workflowConcurrency === -1) {
    return 'none';
  }
  if (/^concurrency:\s*[^\s#]/.test(lines[workflowConcurrency])) {
    return 'false';
  }
  return readCancelInProgress(blockAfter(lines, workflowConcurrency, 0), 2);
}

/**
 * Evaluate a raw `cancel-in-progress` value for one ref.
 * @param {string} value
 * @param {string} ref - GITHUB_REF of the run
 * @returns {boolean|null} null when the value cannot be evaluated
 */
export function evaluateCancelInProgress(value, ref) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false' || value === 'none' || value === 'missing') {
    return false;
  }
  const comparison = value.match(
    /^\$\{\{\s*github\.ref\s*(==|!=)\s*'([^']*)'\s*\}\}$/
  );
  if (!comparison || !ref) {
    return null;
  }
  return comparison[1] === '==' ? ref === comparison[2] : ref !== comparison[2];
}

/**
 * @param {string} body - workflow YAML
 * @param {string[]} jobIds
 * @param {string} ref - GITHUB_REF of the run
 * @returns {{job: string, value: string, cancellable: boolean|null}[]}
 */
export function classifyJobs(body, jobIds, ref) {
  return jobIds.map((job) => {
    const value = readJobCancelInProgress(body, job);
    return { job, value, cancellable: evaluateCancelInProgress(value, ref) };
  });
}

if (
  process.argv?.[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const workflowFile = process.env.WORKFLOW_FILE;
  if (!workflowFile) {
    console.error('WORKFLOW_FILE is required');
    process.exit(2);
  }
  const verbose = process.env.PIPELINE_STATUS_VERBOSE === '1';
  const body = readFileSync(workflowFile, 'utf8');
  const jobs = process.argv.slice(2).filter(Boolean);
  for (const { job, value, cancellable } of classifyJobs(
    body,
    jobs,
    process.env.GITHUB_REF
  )) {
    if (verbose) {
      console.error(
        `[pipeline-status] ${job}: cancel-in-progress=${value} -> ${cancellable}`
      );
    }
    if (cancellable === true) {
      console.log(job);
    }
  }
}
