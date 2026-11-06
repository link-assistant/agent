#!/usr/bin/env node
/**
 * Report every npm advisory in a lock, fail only at an explicit level.
 *
 * `npm audit --audit-level=high` exits 0 for a moderate advisory and prints
 * nothing a reviewer sees, so a green run silently accepts it.
 * This runs the audit once as JSON and:
 *
 * - annotates every advisory below the gate as a warning, and the ones at or
 *   above it as errors, one annotation per advisory (GHSA), not per package;
 * - writes a table of all of them to the step summary;
 * - fails when an advisory reaches AUDIT_LEVEL (default: high);
 * - optionally also fails when an advisory at or above AUDIT_FIXABLE_LEVEL has
 *   a non-breaking fix (`npm audit fix` without --force). The scheduled run
 *   sets it to moderate, so a fixable moderate advisory turns the weekly run
 *   red, while one with no patched release cannot block every pull request.
 *
 * An audit that cannot produce a report (registry error, unparsable output)
 * fails closed.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

function rank(severity) {
  const index = SEVERITIES.indexOf(severity);
  if (index === -1) {
    throw new Error(`Unknown severity: ${severity}`);
  }
  return index;
}

/**
 * Whether `npm audit fix` (without --force) removes the vulnerable version.
 * @param {boolean|{isSemVerMajor?: boolean}} fixAvailable
 */
export function isNonBreakingFix(fixAvailable) {
  return (
    fixAvailable === true ||
    (typeof fixAvailable === 'object' &&
      fixAvailable !== null &&
      fixAvailable.isSemVerMajor === false)
  );
}

function vulnerabilitiesOf(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('npm audit produced no JSON report');
  }
  if (report.error) {
    const { code, summary, detail } = report.error;
    throw new Error(
      `npm audit failed: ${[code, summary, detail].filter(Boolean).join(': ')}`
    );
  }
  if (
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities)
  ) {
    throw new Error('npm audit report has no vulnerabilities map');
  }
  const vulnerabilities = Object.values(report.vulnerabilities);
  for (const vulnerability of vulnerabilities) {
    validateVulnerability(vulnerability, report.vulnerabilities);
  }
  const reachesAdvisory = (name, seen = new Set()) => {
    if (seen.has(name)) {
      return false;
    }
    const next = new Set([...seen, name]);
    return vulnerabilitiesMap[name].via.some(
      (via) => typeof via === 'object' || reachesAdvisory(via, next)
    );
  };
  const vulnerabilitiesMap = report.vulnerabilities;
  for (const name of Object.keys(vulnerabilitiesMap)) {
    if (!reachesAdvisory(name)) {
      throw new Error(
        `npm audit reference-only cycle has no advisory evidence: ${name}`
      );
    }
  }
  return vulnerabilities;
}

function validateAdvisory(via) {
  rank(via.severity);
  const complete = ['title', 'name', 'range'].every(
    (key) => typeof via[key] === 'string' && via[key].trim()
  );
  const identified =
    (typeof via.url === 'string' && /^https:\/\//.test(via.url)) ||
    Number.isInteger(via.source);
  if (!complete || !identified) {
    throw new Error('npm audit advisory is missing identifying evidence');
  }
}

function validateVulnerability(vulnerability, vulnerabilities) {
  if (
    !vulnerability ||
    !Array.isArray(vulnerability.via) ||
    vulnerability.via.length === 0
  ) {
    throw new Error('npm audit vulnerability has no advisory evidence');
  }
  rank(vulnerability.severity);
  for (const via of vulnerability.via) {
    if (
      typeof via === 'string'
        ? !Object.hasOwn(vulnerabilities, via)
        : !via || typeof via !== 'object' || Array.isArray(via)
    ) {
      throw new Error('npm audit vulnerability has invalid advisory evidence');
    }
    if (typeof via === 'object') {
      validateAdvisory(via);
    }
  }
}

/**
 * The advisories a package carries itself. A string `via` names another
 * vulnerable package whose own entry carries the advisory, so counting it
 * here would report the same GHSA twice.
 */
function ownAdvisories(vulnerability) {
  return (vulnerability.via ?? []).filter(
    (via) => typeof via === 'object' && via !== null
  );
}

/**
 * Collapse npm's per-package report into one entry per advisory.
 * @param {object} report - parsed `npm audit --json` output
 */
export function collectAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of vulnerabilitiesOf(report)) {
    for (const via of ownAdvisories(vulnerability)) {
      const url = via.url ?? '';
      const id =
        url.replace(/^https:\/\/github\.com\/advisories\//, '') ||
        String(via.source ?? via.title);
      const entry = advisories.get(id) ?? {
        id,
        title: via.title ?? '',
        url,
        severity: via.severity,
        packages: [],
        fixable: true,
      };
      rank(entry.severity);
      entry.packages.push(`${via.name ?? vulnerability.name}@${via.range}`);
      entry.fixable &&= isNonBreakingFix(vulnerability.fixAvailable);
      advisories.set(id, entry);
    }
  }
  if (advisories.size === 0 && Object.keys(report.vulnerabilities).length > 0) {
    throw new Error('npm audit vulnerabilities contain no advisories');
  }
  return [...advisories.values()].sort(
    (a, b) => rank(b.severity) - rank(a.severity) || a.id.localeCompare(b.id)
  );
}

/**
 * Decide which advisories fail the job.
 * @param {ReturnType<typeof collectAdvisories>} advisories
 * @param {{level?: string, fixableLevel?: string}} options
 */
export function classify(advisories, { level = 'high', fixableLevel } = {}) {
  const gate = rank(level);
  const fixableGate = fixableLevel ? rank(fixableLevel) : Infinity;
  return advisories.map((advisory) => {
    const severity = rank(advisory.severity);
    let blocking = '';
    if (severity >= gate) {
      blocking = `at or above ${level}`;
    } else if (advisory.fixable && severity >= fixableGate) {
      blocking = `${fixableLevel} or above with a non-breaking fix`;
    }
    return { ...advisory, blocking };
  });
}

function escapeData(text) {
  return String(text)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function escapeProperty(text) {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function escapeCell(text) {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/**
 * Render workflow commands, a step summary and the verdict.
 * @param {ReturnType<typeof classify>} classified
 * @param {{directory?: string, level?: string, fixableLevel?: string}} options
 */
export function render(
  classified,
  { directory = '.', level = 'high', fixableLevel } = {}
) {
  const title = escapeProperty(`npm audit (${directory})`);
  const policy = `fails at ${level}${
    fixableLevel ? ` and at ${fixableLevel} when a non-breaking fix exists` : ''
  }`;
  const annotations = classified.map((advisory) => {
    const command = advisory.blocking ? 'error' : 'warning';
    const fix = advisory.fixable
      ? 'npm audit fix resolves it'
      : 'no non-breaking fix available';
    const verdict = advisory.blocking
      ? `fails the job (${advisory.blocking})`
      : `accepted, this job ${policy}`;
    return `::${command} title=${title}::${escapeData(
      `${advisory.id} [${advisory.severity}] ${advisory.title} in ${advisory.packages.join(', ')}; ${fix}; ${verdict}. ${advisory.url}`
    )}`;
  });
  const failing = classified.filter((advisory) => advisory.blocking);
  const summary = [
    `### npm audit: \`${directory}\``,
    '',
    classified.length
      ? `${classified.length} advisory(ies); ${failing.length} fail this job, which ${policy}.`
      : `No advisories. This job ${policy}.`,
  ];
  if (classified.length) {
    summary.push(
      '',
      '| Advisory | Severity | Packages | Non-breaking fix | Result |',
      '| --- | --- | --- | --- | --- |',
      ...classified.map(
        (advisory) =>
          `| [${escapeCell(advisory.id)}](${advisory.url}) ${escapeCell(advisory.title)} | ${advisory.severity} | ${escapeCell(advisory.packages.join(', '))} | ${advisory.fixable ? 'yes' : 'no'} | ${advisory.blocking ? `**fails**: ${advisory.blocking}` : 'reported'} |`
      )
    );
  }
  return {
    annotations,
    summary: `${summary.join('\n')}\n`,
    failed: failing.length > 0,
  };
}

/**
 * Turn raw `npm audit --json` output into the report.
 * @param {string} stdout
 * @param {{directory?: string, level?: string, fixableLevel?: string}} options
 */
export function report(stdout, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm audit output is not JSON: ${error.message}`, {
      cause: error,
    });
  }
  return render(classify(collectAdvisories(parsed), options), options);
}

function runAudit(run, options) {
  const audit = run('npm', ['audit', '--package-lock-only', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (audit.error) {
    throw audit.error;
  }
  if (audit.signal || (audit.status !== 0 && audit.status !== 1)) {
    throw new Error(
      `npm audit execution failed (${audit.signal || `exit ${audit.status}`})`
    );
  }
  const result = report(audit.stdout, options);
  if (audit.status === 1 && result.annotations.length === 0) {
    throw new Error('npm audit exited 1 without advisory evidence');
  }
  return result;
}

export function main(env = process.env, run = spawnSync) {
  const options = {
    directory: env.AUDIT_DIR || '.',
    level: env.AUDIT_LEVEL || 'high',
    fixableLevel: env.AUDIT_FIXABLE_LEVEL || undefined,
  };
  try {
    rank(options.level);
    if (options.fixableLevel) {
      rank(options.fixableLevel);
    }
    const result = runAudit(run, options);
    for (const line of result.annotations) {
      console.log(line);
    }
    console.log(result.summary);
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, result.summary);
    }
    return result.failed ? 1 : 0;
  } catch (error) {
    console.log(
      `::error title=${escapeProperty(`npm audit (${options.directory})`)}::${escapeData(error.message)}`
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
