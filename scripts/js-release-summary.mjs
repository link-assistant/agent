#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Describe npm and GitHub release state even when an earlier step failed. */
export function jsReleaseSummary({
  published = false,
  publishCommandSucceeded = false,
  recovered = false,
  alreadyComplete = false,
  recoverOutcome = 'skipped',
  publishOutcome = 'skipped',
  createOutcome = 'skipped',
  formatOutcome = 'skipped',
  version = '',
} = {}) {
  const npmAccepted = published || publishCommandSucceeded;
  const postStepFailed = [
    recoverOutcome,
    createOutcome,
    formatOutcome,
  ].includes('failure');
  let status;

  if (alreadyComplete && publishOutcome === 'skipped') {
    status = 'Already published to npm; GitHub release complete';
  } else if (!npmAccepted) {
    status = 'Not published to npm';
  } else if (postStepFailed || publishOutcome === 'failure') {
    status = 'Published to npm; post-publish steps incomplete';
  } else if (recovered || createOutcome === 'success') {
    status = 'Published to npm; GitHub release completed';
  } else {
    status = 'Published to npm; GitHub release already existed';
  }

  return `## JS release outcome\n\n| Version | Status |\n| --- | --- |\n| ${version || 'unknown'} | ${status} |\n`;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const summary = jsReleaseSummary({
    published: process.env.RELEASE_PUBLISHED === 'true',
    publishCommandSucceeded: process.env.PUBLISH_COMMAND_SUCCEEDED === 'true',
    recovered: process.env.RELEASE_RECOVERED === 'true',
    alreadyComplete: process.env.RELEASE_ALREADY_COMPLETE === 'true',
    recoverOutcome: process.env.RECOVER_OUTCOME,
    publishOutcome: process.env.PUBLISH_OUTCOME,
    createOutcome: process.env.CREATE_OUTCOME,
    formatOutcome: process.env.FORMAT_OUTCOME,
    version: process.env.RELEASE_VERSION,
  });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
