#!/usr/bin/env node

/**
 * Check broken links against the Wayback Machine (web.archive.org)
 *
 * This script reads the lychee link checker output (markdown format),
 * extracts broken URLs, and checks each one against the Wayback Machine API.
 * It then outputs a report with:
 * - Links that have a web archive version (with suggestion to replace)
 * - Links that have no web archive version (clearly marked as unrecoverable)
 *
 * Usage:
 *   node scripts/check-web-archive.mjs
 *
 * Environment variables:
 *   - LYCHEE_OUTPUT: Path to lychee markdown output file (default: lychee/out.md)
 *   - RECOVERED_URLS: Path to a file listing URLs the re-check
 *     (scripts/recheck-broken-links.mjs) found healthy after lychee got no
 *     answer (default: lychee/recovered.txt). Listed URLs are skipped; a
 *     missing file skips nothing.
 *
 * GitHub Actions outputs:
 *   - all_archived: 'true' if all broken links have a web archive version
 *
 * Exit codes:
 *   - 0: All broken links have web archive versions (or no broken links)
 *   - 1: Some broken links have no web archive version, or lychee reported an
 *        error that has no http(s) URL to look up (missing local file, ...)
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  extractErrorsSection,
  validateLycheeReport,
} from './lychee-report.mjs';

const WAYBACK_API = 'https://archive.org/wayback/available?url=';

/**
 * Write output to GitHub Actions output file
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

/**
 * Extract the "Errors per input" section of a lychee markdown report.
 *
 * Everything after it - most importantly "## Redirects per input" - describes
 * links that resolved successfully, so scanning the whole report would make
 * every redirected link look broken. Reports without that heading (older
 * lychee versions, hand-written fixtures) are parsed in full.
 *
 * @param {string} content - The markdown content from lychee
 * @param {string} kind - Failure section name; defaults to Errors
 * @returns {string} The errors section, or the whole document when there is none
 */
export { extractErrorsSection } from './lychee-report.mjs';

/**
 * Extract broken links from lychee markdown output.
 * Lychee markdown format includes lines like:
 *   * [404] https://example.com/broken-link
 *   * [ERROR] <file:///repo/missing.yml> | File not found
 * @param {string} content - The markdown content from lychee
 * @returns {{urls: string[], others: string[]}} Broken http(s) URLs, and broken
 *   links that cannot be looked up in the Wayback Machine (local files,
 *   unresolvable root-relative links, ...)
 */
export function extractBrokenLinks(content) {
  const section = [
    extractErrorsSection(content),
    extractErrorsSection(content, 'Timeouts'),
  ].join('\n');
  const urls = [];
  const others = [];

  // One bullet per broken link; the status marker is always present, so it
  // anchors the match. Any link shape then qualifies, including the non-HTTP
  // failures (a missing local file, an unresolvable root-relative link) that
  // the Wayback Machine cannot answer.
  const entryPattern =
    /^\s*(?:\*|-)\s+\[(?:4\d\d|5\d\d|ERROR|TIMEOUT|UNKNOWN)\]\s+<?([^\s>|)]+)>?/gim;
  let match;
  while ((match = entryPattern.exec(section)) !== null) {
    const link = match[1].trim().replace(/[.,;!?]+$/, '');
    if (!link) {
      continue;
    }
    if (/^https?:\/\//i.test(link)) {
      if (!urls.includes(link)) {
        urls.push(link);
      }
    } else if (!others.includes(link)) {
      others.push(link);
    }
  }

  return { urls, others };
}

/**
 * Extract broken http(s) URLs from lychee markdown output.
 * @param {string} content - The markdown content from lychee
 * @returns {string[]} Array of broken URLs
 */
export function extractBrokenUrls(content) {
  return extractBrokenLinks(content).urls;
}

/**
 * Drop URLs the re-check found healthy. A URL that never answered lychee but
 * answers the re-check is not a broken link; keeping it in this report would
 * send a healthy URL to the Wayback Machine and fail the job on it.
 * @param {string[]} urls - Broken http(s) URLs extracted from the lychee report
 * @param {string} recoveredText - Contents of the recheck output file, one URL per line
 * @returns {{remaining: string[], recovered: string[]}}
 */
export function splitRecoveredUrls(urls, recoveredText) {
  const recoveredSet = new Set(
    (recoveredText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );

  return {
    remaining: urls.filter((url) => !recoveredSet.has(url)),
    recovered: urls.filter((url) => recoveredSet.has(url)),
  };
}

const NOT_ARCHIVED = { available: false, archiveUrl: null, timestamp: null };

function parseWaybackSnapshot(data) {
  const snapshots = data?.archived_snapshots;
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) {
    throw new Error('unreadable answer: missing archived_snapshots');
  }
  const snapshot = snapshots.closest;
  if (snapshot?.available === true) {
    if (
      typeof snapshot.url !== 'string' ||
      !/^https?:\/\//.test(snapshot.url) ||
      typeof snapshot.timestamp !== 'string'
    ) {
      throw new Error('unreadable answer: invalid snapshot');
    }
    return {
      available: true,
      archiveUrl: snapshot.url.replace(/^http:\/\//, 'https://'),
      timestamp: snapshot.timestamp,
    };
  }
  if (Object.keys(snapshots).length === 0 || snapshot?.available === false) {
    return { ...NOT_ARCHIVED };
  }
  throw new Error('unreadable answer: invalid archived_snapshots');
}

async function fetchWaybackSnapshot(apiUrl, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(
    () => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  try {
    const response = await fetchImpl(apiUrl, {
      headers: {
        'User-Agent': 'broken-link-checker/1.0 (GitHub Actions CI)',
      },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.ok) {
      return { ...NOT_ARCHIVED, error: `HTTP ${response.status}` };
    }
    return parseWaybackSnapshot(await response.json());
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    const cause = reason.cause?.code ?? reason.cause?.message;
    throw new Error(cause ? `${reason.message}: ${cause}` : reason.message, {
      cause: error,
    });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function validateLookupOptions({ attempts, timeoutMs, delayMs }) {
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(delayMs) ||
    delayMs < 0
  ) {
    throw new RangeError(
      'Wayback attempts and timeout must be positive; delay must be nonnegative'
    );
  }
}

/**
 * Check the availability API with bounded retries for transient lookup failures.
 * Empty snapshots confirm absence; exhausted lookups return an error instead.
 * @param {string} url - The URL to check
 * @returns {Promise<{available: boolean, archiveUrl: string|null, timestamp: string|null, error?: string}>}
 */
export async function checkWaybackMachine(
  url,
  {
    fetchImpl = fetch,
    attempts = 3,
    delayMs = 2000,
    timeoutMs = 10000,
    sleep: wait = sleep,
  } = {}
) {
  validateLookupOptions({ attempts, timeoutMs, delayMs });
  const apiUrl = `${WAYBACK_API}${encodeURIComponent(url)}`;
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      console.log(
        `  Retrying Wayback lookup (attempt ${attempt}/${attempts}) after: ${failure}`
      );
      await wait(delayMs * 2 ** (attempt - 2));
    }
    try {
      return await fetchWaybackSnapshot(apiUrl, { fetchImpl, timeoutMs });
    } catch (error) {
      failure = error.message;
    }
  }
  return { ...NOT_ARCHIVED, error: `${failure} (after ${attempts} attempts)` };
}

/**
 * Render a Wayback Machine timestamp (YYYYMMDDHHmmss) as a readable date
 * @param {string} timestamp - e.g. "20231015143022"
 * @returns {string} Date formatted as YYYY-MM-DD
 */
function formatTimestamp(timestamp) {
  if (!timestamp || timestamp.length < 8) {
    return timestamp;
  }
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  return `${year}-${month}-${day}`;
}

/**
 * Report lychee errors that have no http(s) URL to look up in the Wayback
 * Machine. Local files and unresolvable root-relative links have no archived
 * equivalent, so they can never be `all_archived` and always fail the check.
 * @param {string[]} unarchivableLinks - Broken links that are not http(s) URLs
 */
function reportUnarchivableLinks(unarchivableLinks) {
  if (unarchivableLinks.length === 0) {
    return;
  }

  console.log(
    `✗ ${unarchivableLinks.length} broken link(s) cannot be checked against the Web Archive:`
  );
  for (const link of unarchivableLinks) {
    console.log(`  ${link}`);
    console.log(
      '::error title=Broken link - not recoverable from the Web Archive::' +
        `Broken link detected: ${link}\n` +
        'It is not an http(s) URL (missing file, unresolvable relative link, ...),\n' +
        'so the Wayback Machine cannot provide a fallback.\n' +
        'How to fix: correct the path, restore the missing file, or pass --root-dir\n' +
        'to lychee so root-relative links resolve.'
    );
  }
  console.log('');
}

/**
 * Report broken links that have a Wayback Machine snapshot as suggestions
 * @param {Array<{url: string, archiveUrl: string, date: string}>} withArchive - Archived links
 */
function reportArchivedLinks(withArchive) {
  if (withArchive.length === 0) {
    return;
  }

  console.log(
    `✓ ${withArchive.length} broken link(s) have Web Archive versions - consider replacing:`
  );
  for (const { url, archiveUrl, date } of withArchive) {
    console.log(`  Original: ${url}`);
    console.log(`  Archive (${date}): ${archiveUrl}`);
    console.log('');
  }

  // Print GitHub Actions annotations as suggestions (one per link)
  for (const { url, archiveUrl, date } of withArchive) {
    console.log(
      `::notice title=Broken link - Web Archive available (${date})::` +
        `Broken link detected: ${url}\n` +
        `A Web Archive snapshot from ${date} is available.\n` +
        `Suggested fix: replace the broken link with the archived version:\n` +
        `  ${archiveUrl}`
    );
  }
}

/**
 * Report broken links that have no Wayback Machine snapshot as errors
 * @param {string[]} withoutArchive - Broken URLs with no archived version
 */
function reportUnarchivedUrls(withoutArchive) {
  if (withoutArchive.length === 0) {
    return;
  }

  console.log(
    `✗ ${withoutArchive.length} broken link(s) have NO Web Archive version:`
  );
  for (const url of withoutArchive) {
    console.log(`  ${url}`);
  }
  console.log('');

  // Print GitHub Actions annotations as errors (one per link)
  for (const url of withoutArchive) {
    console.log(
      `::error title=Broken link - No Web Archive fallback::` +
        `Broken link detected: ${url}\n` +
        `No archived version was found in the Wayback Machine.\n` +
        `How to fix:\n` +
        `  1. Find an updated URL for the same or equivalent content and replace the link.\n` +
        `  2. Remove the link if the content is no longer relevant.\n` +
        `  3. Add the URL to .lycheeignore if it is a known false positive (e.g. localhost, example.com).`
    );
  }
}

function reportLookupSummary({
  withArchive,
  withoutArchive,
  lookupFailures,
  unarchivableLinks,
}) {
  console.log('\n=== Web Archive Check Summary ===\n');

  reportArchivedLinks(withArchive);
  reportUnarchivedUrls(withoutArchive);
  for (const { url, error } of lookupFailures) {
    console.log(
      `::error title=Broken link - Web Archive lookup failed::${url}: ${error}\n` +
        'Re-run the job or check the Wayback Machine manually when the service recovers.\n' +
        'The lookup did not establish whether an archived version exists.'
    );
  }

  const allArchived =
    withoutArchive.length === 0 &&
    unarchivableLinks.length === 0 &&
    lookupFailures.length === 0;
  setOutput('all_archived', allArchived ? 'true' : 'false');

  if (!allArchived) {
    if (withoutArchive.length || unarchivableLinks.length) {
      console.log(
        '\nAction required: Fix or remove the confirmed broken links listed above.'
      );
    }
    console.log(
      'For links with Web Archive versions, you can replace them with the suggested archive.org URLs.'
    );
    return 1;
  } else {
    console.log(
      '\nAll broken links have Web Archive versions. Consider replacing them with the suggested archive.org URLs.'
    );
    return 0;
  }
}

function readRequiredReport(lycheeOutput) {
  if (!existsSync(lycheeOutput)) {
    throw new Error(`Required lychee report is missing: ${lycheeOutput}`);
  }

  const content = readFileSync(lycheeOutput, 'utf-8');
  const { urls: extractedUrls, others: unarchivableLinks } =
    extractBrokenLinks(content);
  const checkerFailed =
    process.env.LYCHEE_EXIT_CODE !== undefined &&
    process.env.LYCHEE_EXIT_CODE !== '0';
  const hasFailures = extractedUrls.length + unarchivableLinks.length > 0;
  validateLycheeReport(content, hasFailures, checkerFailed);

  return { extractedUrls, unarchivableLinks };
}

async function main() {
  const lycheeOutput = process.env.LYCHEE_OUTPUT || 'lychee/out.md';
  console.log('=== Web Archive Fallback Check ===\n');
  console.log(`Reading lychee output from: ${lycheeOutput}\n`);
  const { extractedUrls, unarchivableLinks } = readRequiredReport(lycheeOutput);
  const recoveredFile = process.env.RECOVERED_URLS || 'lychee/recovered.txt';
  const recoveredText = existsSync(recoveredFile)
    ? readFileSync(recoveredFile, 'utf-8')
    : '';
  const { remaining: brokenUrls, recovered: recheckedHealthy } =
    splitRecoveredUrls(extractedUrls, recoveredText);

  for (const url of recheckedHealthy) {
    console.log(
      `✓ ${url} never answered lychee but answers the re-check -- not broken`
    );
  }

  reportUnarchivableLinks(unarchivableLinks);

  if (brokenUrls.length === 0) {
    console.log('No broken URLs found in lychee output.');
    const clean = unarchivableLinks.length === 0;
    setOutput('all_archived', clean ? 'true' : 'false');
    process.exit(clean ? 0 : 1);
  }

  console.log(
    `Found ${brokenUrls.length} broken URL(s). Checking Web Archive...\n`
  );

  const withArchive = [];
  const withoutArchive = [];
  const lookupFailures = [];

  for (const url of brokenUrls) {
    console.log(`Checking: ${url}`);
    const result = await checkWaybackMachine(url);

    if (result.error) {
      console.log(`  ✗ Web Archive lookup failed: ${result.error}`);
      lookupFailures.push({ url, error: result.error });
    } else if (result.available) {
      const date = formatTimestamp(result.timestamp);
      console.log(`  ✓ Archived on ${date}: ${result.archiveUrl}`);
      withArchive.push({ url, archiveUrl: result.archiveUrl, date });
    } else {
      console.log('  ✗ Not found in Web Archive');
      withoutArchive.push(url);
    }

    // Small delay to avoid rate-limiting the Wayback API
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
  }

  process.exit(
    reportLookupSummary({
      withArchive,
      withoutArchive,
      lookupFailures,
      unarchivableLinks,
    })
  );
}

const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch((error) => {
    setOutput('all_archived', 'false');
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
