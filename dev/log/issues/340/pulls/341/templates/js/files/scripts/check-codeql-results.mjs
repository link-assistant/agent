#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function reportsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory()
      ? reportsIn(file)
      : entry.isFile() && /\.sarif(?:\.json)?$/.test(entry.name)
        ? [file]
        : [];
  });
}

function describeNotification(notification) {
  const descriptor =
    notification?.descriptor?.id ??
    notification?.associatedRule?.id ??
    'unknown diagnostic';
  const locations = Array.isArray(notification?.locations)
    ? notification.locations
        .map((location) => {
          const physical = location?.physicalLocation;
          return `${physical?.artifactLocation?.uri ?? 'unknown location'}:${physical?.region?.startLine ?? '?'}`;
        })
        .join(', ')
    : '';
  return `${descriptor} ${locations}`;
}

function validNotification(notification, message, level) {
  return (
    notification &&
    !Array.isArray(notification) &&
    typeof notification === 'object' &&
    typeof message === 'string' &&
    ['error', 'warning', 'note', 'none'].includes(level)
  );
}

function invocationDiagnostics(invocation, file, runIndex) {
  const failures = [];
  for (const key of [
    'toolExecutionNotifications',
    'toolConfigurationNotifications',
  ]) {
    const notifications = invocation[key];
    if (notifications === undefined) {
      continue;
    }
    if (!Array.isArray(notifications)) {
      failures.push(`${file} run ${runIndex}: malformed ${key}`);
      continue;
    }
    for (const notification of notifications) {
      const level = notification?.level ?? 'warning';
      const message =
        notification?.message?.text ?? notification?.message?.markdown;
      if (!validNotification(notification, message, level)) {
        failures.push(`${file} run ${runIndex}: malformed ${key} notification`);
      } else if (level === 'error' || level === 'warning') {
        failures.push(
          `${file} run ${runIndex}: ${key} ${describeNotification(notification)} [${level}] ${message}`
        );
      }
    }
  }
  return failures;
}

function checkRun(run, index, file) {
  if (
    typeof run?.tool?.driver?.name !== 'string' ||
    !run.tool.driver.name.trim() ||
    !Array.isArray(run.results) ||
    (run.invocations !== undefined &&
      (!Array.isArray(run.invocations) ||
        run.invocations.some(
          (invocation) => invocation?.executionSuccessful !== true
        )))
  ) {
    throw new Error(
      `Invalid results/tool or unsuccessful invocation in run ${index}`
    );
  }
  return [
    ...(run.invocations ?? []).flatMap((invocation) =>
      invocationDiagnostics(invocation, file, index)
    ),
    ...run.results.map(
      (finding) =>
        `${file} run ${index}: ${finding?.ruleId ?? 'unknown rule'} [${finding?.level ?? 'unspecified severity'}] ${finding?.message?.text ?? 'CodeQL finding'}`
    ),
  ];
}

function checkReport(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (
    report?.version !== '2.1.0' ||
    !Array.isArray(report.runs) ||
    !report.runs.length
  ) {
    throw new Error('Invalid SARIF version or missing runs');
  }
  return report.runs.flatMap((run, index) => {
    try {
      return checkRun(run, index, file);
    } catch (error) {
      return [`${file}: ${error.message}`];
    }
  });
}

export function checkCodeqlResults(directory, log = console.error) {
  const files = reportsIn(directory);
  if (!files.length) {
    throw new Error(`Missing CodeQL SARIF reports: ${directory}`);
  }
  const failures = [];
  for (const file of files) {
    try {
      failures.push(...checkReport(file));
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }
  for (const failure of failures) {
    log(failure);
  }
  if (failures.length) {
    throw new Error(
      `CodeQL result gate rejected ${failures.length} finding(s) or report error(s)`
    );
  }
  return files.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      `CodeQL result gate: ${checkCodeqlResults(process.argv[2] || 'codeql-results')} clean report(s)`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
