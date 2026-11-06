#!/usr/bin/env node

/**
 * Re-check unanswered links and transient HTTP 429/5xx failures.
 *
 * lychee's `--max-retries` cannot retry a connection reset during connect
 * (lycheeverse/lychee#2297: the error is classified by its phase, and the
 * connect phase is answered `false`), so a healthy URL that answers a RST —
 * a normal event for a rate-limiting or load-shedding host seen from a CI
 * address range — is reported as broken without a single retry. This script
 * asks those URLs again, outside lychee.
 *
 * Permanent HTTP failures remain final: a 404 is never re-checked. A 429
 * or 5xx is retried with backoff, and stays failed if it never recovers.
 *
 * Environment variables:
 *   - LYCHEE_OUTPUT: Path to the lychee markdown report
 *     (default: lychee/out.md)
 *   - RECOVERED_OUTPUT: Where to write the URLs the re-check found healthy
 *     (default: lychee/recovered.txt)
 *   - RECHECK_BUDGET_SECONDS: Total wall-clock budget for the re-check
 *     (default: 240; must expire before the job's 10-minute cap)
 *   - RECHECK_WAIT_MS: Initial wait between rounds; doubles every round
 *     (default: 2000)
 *
 * GitHub Actions outputs:
 *   - all_recovered: 'true' only when the complete lychee report contains no
 *     permanent failures and every transient failure recovered on re-check.
 *     Consumers must test `!= 'true'`, never `== 'false'`: a
 *     skipped or crashed step leaves the output empty, and only the `!=`
 *     form fails safe.
 *
 * Exit codes:
 *   - 0 in every case. This script downgrades failures; it never raises
 *     them, so a bug here cannot turn a green run red.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractErrorsSection, validateLycheeReport } from './check-web-archive.mjs';

// Environment-derived settings are read inside main(), not here: a test run
// with a restricted environment must be able to import this module without
// touching process.env at load time.
const BUDGET_SECONDS_DEFAULT = 240;
const INITIAL_WAIT_MS_DEFAULT = 2000;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT_DEFAULT = 'lychee';
// lychee's documented default --accept list; used when the workflow does not
// set the flag. scripts/recheck-broken-links.test.mjs reads this file and the
// workflow together, so the two cannot drift apart.
const ACCEPT_DEFAULT = '100..=103,200..=299';

/**
 * Split the lychee markdown report into per-failure records.
 *
 * A failure is "answered" when a numeric status marker is present ([404])
 * or the detail says "Rejected status code". Only permanent statuses are
 * final; 429 and 5xx remain retryable. Other errors received no HTTP answer.
 * @param {string} content - The markdown content from lychee
 * @returns {Array<{marker: string, url: string, detail: string, answered: boolean, retryable: boolean}>}
 */
export function parseLycheeFailures(content) {
  const failures = [];
  const entryPattern =
    /^[ \t]*(?:\*|-)[ \t]+\[([^\]\r\n]+)\][ \t]+<?([^\s>|)]+)>?(?:[ \t]+\(at [^)\r\n]*\))?[ \t]*\|?[ \t]*([^\r\n]*)\r?$/gim;

  const section = extractErrorsSection(content);
  let match;
  while ((match = entryPattern.exec(section)) !== null) {
    const marker = match[1].trim();
    const url = match[2].trim().replace(/[.,;!?]+$/, '');
    const detail = match[3].trim();

    if (!url) {
      continue;
    }

    const answered =
      /^\d{3}$/.test(marker) || /rejected status code/i.test(detail);

    const status = /^\d{3}$/.test(marker)
      ? Number(marker)
      : Number(detail.match(/rejected status code:\s*(\d{3})/i)?.[1]);
    const retryable = !answered || isTransientStatus(status);
    failures.push({ marker, url, detail, answered, retryable });
  }

  return failures;
}

/**
 * Build an "is this status accepted" predicate from a lychee --accept list
 * such as "100..=103,200..=299,429" (spaces tolerated).
 * @param {string} spec - The lychee --accept list
 * @returns {(status: number) => boolean}
 */
export function parseAcceptRanges(spec) {
  const accepted = [];

  for (const part of spec.split(',')) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    const range = trimmed.match(/^(\d+)\.\.=(\d+)$/);

    if (range) {
      for (
        let status = Number(range[1]);
        status <= Number(range[2]);
        status += 1
      ) {
        accepted.push(status);
      }
      continue;
    }

    if (/^\d{3}$/.test(trimmed)) {
      accepted.push(Number(trimmed));
    }
  }

  return (status) => accepted.includes(status);
}

/**
 * Extract the --accept list and --user-agent the lychee step runs with, so
 * the re-check judges a URL by the same rules the checker used.
 * @param {string} workflowText - The links.yml content
 * @returns {{accept: string, userAgent: string}}
 */
export function extractLycheeRequestOptions(workflowText) {
  const accept = workflowText.match(/--accept[=\s]+["']?([^\s"']+)["']?/);
  const userAgent = workflowText.match(
    /--user-agent[=\s]+["']?([^\s"']+)["']?/
  );

  return {
    accept: accept ? accept[1] : ACCEPT_DEFAULT,
    userAgent: userAgent ? userAgent[1] : USER_AGENT_DEFAULT,
  };
}

export function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Retry unanswered and 429/5xx URLs sequentially with bounded doubling waits.
 * An accepted status recovers the URL; a permanent rejected status is final.
 * @param {string[]} urls - The retryable URLs from lychee
 * @param {{accept: string, userAgent: string, budgetSeconds?: number, initialWaitMs?: number, fetchImpl?: typeof fetch}} options
 * @returns {Promise<{recovered: string[], stillBroken: Array<{url: string, status: number|null, reason: string}>}>}
 */
export async function recheckUnanswered(urls, options) {
  const accept = parseAcceptRanges(options.accept);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const budgetMs = (options.budgetSeconds ?? BUDGET_SECONDS_DEFAULT) * 1000;
  const startedAt = Date.now();
  const initialWaitMs = options.initialWaitMs ?? INITIAL_WAIT_MS_DEFAULT;
  let waitMs = initialWaitMs;
  let round = 0;

  const recovered = [];
  const rejected = [];
  let pending = [...new Set(urls)];

  while (pending.length > 0 && Date.now() - startedAt < budgetMs) {
    if (round > 0) {
      const elapsed = Date.now() - startedAt;

      if (elapsed + waitMs > budgetMs) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs *= 2;
    }

    round += 1;
    const stillPending = [];

    for (const url of pending) {
      const remainingMs = budgetMs - (Date.now() - startedAt);
      if (remainingMs <= 0) { stillPending.push(url); continue; }
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(REQUEST_TIMEOUT_MS, remainingMs)
      );
      let response;

      try {
        response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'user-agent': options.userAgent },
        });
      } catch {
        // No host answered this round; it stays eligible for the next one.
        stillPending.push(url);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      // Release response bodies so connections and memory stay bounded.
      await response.body?.cancel();
      if (accept(response.status)) {
        recovered.push(url);
      } else if (isTransientStatus(response.status)) {
        stillPending.push(url);
      } else {
        rejected.push({
          url,
          status: response.status,
          reason: `answered ${response.status}, which lychee does not accept`,
        });
      }
    }

    pending = stillPending;
  }

  return {
    recovered,
    stillBroken: [
      ...rejected,
      ...pending.map((url) => ({
        url,
        status: null,
        reason: 'no accepted response within the re-check budget',
      })),
    ],
  };
}

/**
 * Decide whether the original lychee failure report is now completely clean.
 * Keeping this as a predicate makes it difficult to accidentally judge only
 * the retryable subset and forget an answered/final failure such as a 404.
 * @param {number} finalFailureCount
 * @param {number} unansweredCount
 * @param {{recovered: string[], stillBroken: unknown[]}} result
 * @returns {boolean}
 */
export function allFailuresRecovered(
  finalFailureCount,
  unansweredCount,
  result
) {
  return (
    finalFailureCount === 0 &&
    unansweredCount > 0 &&
    result.stillBroken.length === 0 &&
    result.recovered.length === unansweredCount
  );
}

async function main() {
  const lycheeOutput = process.env.LYCHEE_OUTPUT || 'lychee/out.md';
  const recoveredOutput =
    process.env.RECOVERED_OUTPUT || 'lychee/recovered.txt';
  const workflowText = readFileSync('.github/workflows/links.yml', 'utf8');
  const options = extractLycheeRequestOptions(workflowText);
  const content = readFileSync(lycheeOutput, 'utf8');
  validateLycheeReport(content);
  const failures = parseLycheeFailures(content);

  const finalFailures = failures.filter(
    (failure) => !failure.retryable || !/^https?:\/\//i.test(failure.url)
  );
  const unanswered = [...new Set(failures
    .filter((failure) => failure.retryable && /^https?:\/\//i.test(failure.url))
    .map((failure) => failure.url))];

  console.log(
    `Re-check: ${failures.length} lychee failure(s), ${finalFailures.length} permanent failures, ${unanswered.length} retryable failures`
  );

  if (unanswered.length === 0) {
    console.log('Re-check: nothing to re-ask.');
    return;
  }

  const result = await recheckUnanswered(unanswered, {
    ...options,
    budgetSeconds: Number(
      process.env.RECHECK_BUDGET_SECONDS || BUDGET_SECONDS_DEFAULT
    ),
    initialWaitMs: Number(
      process.env.RECHECK_WAIT_MS || INITIAL_WAIT_MS_DEFAULT
    ),
  });

  for (const url of result.recovered) {
    console.log(
      `::notice::${url} failed transiently in lychee but answers ${options.accept} now -- not a broken link`
    );
  }

  if (result.recovered.length > 0) {
    writeFileSync(recoveredOutput, `${result.recovered.join('\n')}\n`);
  }

  console.log(
    `Re-check finished: ${result.recovered.length} recovered, ${result.stillBroken.length} still failed`
  );

  if (allFailuresRecovered(finalFailures.length, unanswered.length, result)) {
    appendFileSync(
      process.env.GITHUB_OUTPUT || '/dev/null',
      'all_recovered=true\n'
    );
  }
}

// The re-check only ever downgrades failures, so any crash here must not
// mask itself as a verdict: exit 0 in every case.
const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Re-check crashed (treating as no recovery): ${error}`);
    process.exit(0);
  });
}
