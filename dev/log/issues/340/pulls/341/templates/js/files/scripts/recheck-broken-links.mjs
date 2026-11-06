#!/usr/bin/env node

/**
 * Re-check transport failures and transient HTTP 429/5xx responses.
 *
 * lychee's `--max-retries` cannot retry a connection reset during connect
 * (lycheeverse/lychee#2297: the error is classified by its phase, and the
 * connect phase is answered `false`), so a healthy URL that answers a RST —
 * a normal event for a rate-limiting or load-shedding host seen from a CI
 * address range — is reported as broken without a single retry. This script
 * asks those URLs again, outside lychee.
 *
 * Definitive HTTP errors, including 404, remain final. Transient responses
 * require a successful re-request or GitHub contents API response to recover.
 *
 * Environment variables:
 *   - LYCHEE_OUTPUT: Path to the lychee markdown report
 *     (default: lychee/out.md)
 *   - RECOVERED_OUTPUT: Where to write the URLs the re-check found healthy
 *     (default: lychee/recovered.txt)
 *   - RECHECK_BUDGET_SECONDS: Total wall-clock budget for the re-check
 *     (default: 240; must expire before the job's 10-minute cap)
 *   - GITHUB_TOKEN: Token for the GitHub contents API fallback
 *   - RECHECK_VERBOSE: Log request statuses and waits (default: false)
 *   - RECHECK_WAIT_MS: Initial wait between rounds; doubles every round
 *     (default: 5000; capped at 30000)
 *
 * GitHub Actions outputs:
 *   - all_recovered: 'true' when the report contained nothing but transient
 *     failures and every one of them answered healthy on re-check. Consumers
 *     must test `!= 'true'`, never `== 'false'`: a
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
import {
  extractErrorsSection,
  validateLycheeReport,
} from './lychee-report.mjs';

// Environment-derived settings are read inside main(), not here: the Deno
// test leg imports this module under `--allow-read` only, and any
// module-scope process.env access would throw NotCapable at import time.
const BUDGET_SECONDS_DEFAULT = 240;
const INITIAL_WAIT_MS_DEFAULT = 5000;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT_DEFAULT = 'lychee';
// lychee's documented default --accept list; used when the workflow does not
// set the flag. tests/recheck-broken-links.test.js reads this file and the
// workflow together, so the two cannot drift apart.
const ACCEPT_DEFAULT = '100..=103,200..=299';

/**
 * Split the lychee markdown report into per-failure records.
 *
 * A failure is "answered" when a numeric status marker is present ([404])
 * or the detail says "Rejected status code". Such an answer is retryable
 * only for 429 or 5xx. Other markers denote unanswered failures.
 * @param {string} content - The markdown content from lychee
 * @returns {Array<{marker: string, url: string, detail: string, answered: boolean, retryable: boolean}>}
 */
export function parseLycheeFailures(content) {
  const failures = [];
  const entryPattern =
    /^[ \t]*(?:\*|-)[ \t]+\[([^\]]+)\][ \t]+<?([^\s>|)]+)>?(?:[ \t]+\(at [^)]*\))?[ \t]*\|?[ \t]*([^\r\n]*)$/gim;
  const section = [
    extractErrorsSection(content),
    extractErrorsSection(content, 'Timeouts'),
  ].join('\n');

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
      : Number(detail.match(/rejected status code:?\s*(\d{3})/i)?.[1]);
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

/** Whether an HTTP error can clear on a later request. */
export function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Resolve only GitHub blob/tree pages; credentials never go to the page host. */
export function githubContentsUrl(value) {
  const url = new globalThis.URL(value);
  if (url.hostname !== 'github.com' || url.protocol !== 'https:') {
    return null;
  }
  const parts = url.pathname.split('/').slice(1);
  const [owner, repo, kind, ref, ...file] = parts;
  if (
    !owner ||
    !repo ||
    !['blob', 'tree'].includes(kind) ||
    !ref ||
    !file.length
  ) {
    return null;
  }
  const encoded = (part) => encodeURIComponent(decodeURIComponent(part));
  return `https://api.github.com/repos/${encoded(owner)}/${encoded(repo)}/contents/${file.map(encoded).join('/')}?ref=${encoded(ref)}`;
}

/** Recover only with a successful API answer, never with an error or redirect. */
async function recoverViaGithub(url, status, { options, request, accept }) {
  if ((status === null || isTransientStatus(status)) && options.githubToken) {
    const apiUrl = githubContentsUrl(url);
    if (apiUrl) {
      const apiStatus = await request(apiUrl, true);
      if (apiStatus !== null && accept(apiStatus)) {
        return apiStatus;
      }
    }
  }
  return status;
}

function recheckRuntime(options) {
  return {
    log: options.log || (() => {}),
    now: options.nowFn || Date.now,
  };
}

/**
 * Ask every URL once more, round-robin with a doubling wait, until everything
 * answers accepted or the budget runs out. Only transport failures, 429,
 * and 5xx are retried; other rejected answers stay final.
 * @param {string[]} urls - The transient failures from lychee
 * @param {{accept: string, userAgent: string, budgetSeconds?: number, initialWaitMs?: number, fetchImpl?: typeof fetch}} options
 * @returns {Promise<{recovered: string[], stillBroken: Array<{url: string, status: number|null, reason: string}>}>}
 */
export async function recheckUnanswered(urls, options) {
  const accept = parseAcceptRanges(options.accept);
  const { log, now } = recheckRuntime(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep =
    options.sleepFn ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const budgetMs = (options.budgetSeconds ?? BUDGET_SECONDS_DEFAULT) * 1000;
  const deadline = now() + budgetMs;
  let waitMs = options.initialWaitMs ?? INITIAL_WAIT_MS_DEFAULT;
  const recovered = [];
  const rejected = [];
  let pending = [...new Set(urls)];

  const request = async (url, api = false) => {
    const remaining = deadline - now();
    if (remaining <= 0) {
      return null;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Math.min(REQUEST_TIMEOUT_MS, remaining)
    );
    try {
      const response = await fetchImpl(url, {
        method: api ? 'GET' : 'HEAD',
        redirect: api ? 'error' : 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': options.userAgent,
          ...(api
            ? {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${options.githubToken}`,
              }
            : {}),
        },
      });
      // Only status is needed; avoid retaining API response bodies/connections.
      await response.body?.cancel();
      log(`${api ? 'GitHub API' : 'Page'} ${url}: HTTP ${response.status}`);
      return response.status;
    } catch (error) {
      log(`${api ? 'GitHub API' : 'Page'} ${url}: ${error.message}`);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  while (pending.length > 0 && now() < deadline) {
    const stillPending = [];
    for (const url of pending) {
      let status = await request(url);
      status = await recoverViaGithub(url, status, {
        options,
        request,
        accept,
      });
      if (status !== null && accept(status)) {
        recovered.push(url);
      } else if (status === null || isTransientStatus(status)) {
        stillPending.push(url);
      } else {
        rejected.push({
          url,
          status,
          reason: `answered ${status}, which lychee does not accept`,
        });
      }
    }
    pending = stillPending;
    if (pending.length === 0 || now() + waitMs >= deadline) {
      break;
    }
    log(`Waiting ${waitMs}ms before retrying ${pending.length} link(s)`);
    await sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 30000);
  }
  return {
    recovered,
    stillBroken: [
      ...rejected,
      ...pending.map((url) => ({
        url,
        status: null,
        reason: 'no answer within the re-check budget',
      })),
    ],
  };
}

/**
 * Whether the re-check cleared every failure in the complete lychee report.
 * Keeping this as a report-level predicate prevents a recovered transient
 * error from hiding an answered failure such as a 404.
 * @param {{finalFailureCount: number, stillBrokenCount: number, unansweredCount: number, recoveredCount: number}} counts
 * @returns {boolean}
 */
export function allFailuresRecovered(counts) {
  return (
    counts.finalFailureCount === 0 &&
    counts.stillBrokenCount === 0 &&
    counts.unansweredCount > 0 &&
    counts.recoveredCount === counts.unansweredCount
  );
}

async function main() {
  const lycheeOutput = process.env.LYCHEE_OUTPUT || 'lychee/out.md';
  const recoveredOutput =
    process.env.RECOVERED_OUTPUT || 'lychee/recovered.txt';
  const workflowText = readFileSync('.github/workflows/links.yml', 'utf8');
  const options = extractLycheeRequestOptions(workflowText);
  const content = readFileSync(lycheeOutput, 'utf8');
  const failures = parseLycheeFailures(content);
  validateLycheeReport(content, failures.length > 0);

  const finalFailures = failures.filter(
    (failure) => !failure.retryable || !/^https?:\/\//i.test(failure.url)
  );
  const unanswered = failures
    .filter((failure) => failure.retryable && /^https?:\/\//i.test(failure.url))
    .map((failure) => failure.url);

  console.log(
    `Re-check: ${failures.length} lychee failure(s), ${finalFailures.length} final, ${unanswered.length} transient or unanswered`
  );

  if (unanswered.length === 0) {
    console.log('Re-check: nothing to re-ask.');
    return;
  }

  const result = await recheckUnanswered(unanswered, {
    ...options,
    githubToken: process.env.GITHUB_TOKEN,
    log: process.env.RECHECK_VERBOSE === 'true' ? console.log : undefined,
    budgetSeconds: Number(
      process.env.RECHECK_BUDGET_SECONDS || BUDGET_SECONDS_DEFAULT
    ),
    initialWaitMs: Number(
      process.env.RECHECK_WAIT_MS || INITIAL_WAIT_MS_DEFAULT
    ),
  });

  for (const url of result.recovered) {
    console.log(
      `::notice::${url} never answered lychee but answers ${options.accept} now -- not a broken link`
    );
  }

  if (result.recovered.length > 0) {
    writeFileSync(recoveredOutput, `${result.recovered.join('\n')}\n`);
  }

  console.log(
    `Re-check finished: ${result.recovered.length} recovered, ${result.stillBroken.length} still without an answer`
  );

  if (
    allFailuresRecovered({
      finalFailureCount: finalFailures.length,
      stillBrokenCount: result.stillBroken.length,
      unansweredCount: unanswered.length,
      recoveredCount: result.recovered.length,
    })
  ) {
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
