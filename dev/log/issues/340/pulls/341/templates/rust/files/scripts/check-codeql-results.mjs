#!/usr/bin/env node
// Analyze/upload success establishes delivery, not the absence of findings.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function reportsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected SARIF symlink: ${file}`);
    if (entry.isDirectory()) return reportsIn(file);
    return entry.isFile() && entry.name.endsWith('.sarif') ? [file] : [];
  });
}

// Invocation success does not guarantee complete extraction. SARIF defaults an
// omitted notification level to warning, including configuration diagnostics.
function invocationDiagnostics(invocation, context) {
  const failures = [];
  for (const field of ['toolExecutionNotifications', 'toolConfigurationNotifications']) {
    if (!Object.hasOwn(invocation, field)) continue;
    if (!Array.isArray(invocation[field])) throw new Error(`Malformed SARIF notification array: ${context}, ${field}`);
    for (const notification of invocation[field]) {
      const level = notification?.level ?? 'warning';
      if (!notification || typeof notification !== 'object' || Array.isArray(notification) ||
          !(typeof notification.message?.text === 'string' || typeof notification.message?.markdown === 'string') ||
          (Object.hasOwn(notification, 'level') && !['error', 'warning', 'note', 'none'].includes(notification.level))) {
        throw new Error(`Malformed SARIF notification: ${context}, ${field}`);
      }
      if (level === 'note' || level === 'none') continue;
      const location = notification.locations?.[0]?.physicalLocation;
      failures.push(`${context}, ${field}: ${notification.descriptor?.id ?? notification.descriptor?.index ?? '?'} (${level}) ` +
        `${location?.artifactLocation?.uri ?? '?'}:${location?.region?.startLine ?? '?'}: ` +
        `${notification.message.text ?? notification.message.markdown}`);
    }
  }
  return failures;
}

export function checkCodeqlResults(directory) {
  const reports = reportsIn(directory).sort();
  if (!reports.length) throw new Error(`No SARIF reports in ${directory}`);
  const findings = [];
  const diagnostics = [];
  for (const file of reports) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.version !== '2.1.0' || !Array.isArray(data.runs) || !data.runs.length) {
      throw new Error(`Invalid SARIF report: ${file}`);
    }
    for (const [index, run] of data.runs.entries()) {
      const context = `${file}, run ${index + 1}`;
      if (run?.tool?.driver?.name !== 'CodeQL' || !Array.isArray(run.results) ||
          !Array.isArray(run.invocations) || !run.invocations.length ||
          run.invocations.some((invocation) => invocation?.executionSuccessful !== true)) {
        throw new Error(`Missing or unsuccessful CodeQL analysis: ${context}`);
      }
      for (const [invocationIndex, invocation] of run.invocations.entries()) {
        diagnostics.push(...invocationDiagnostics(invocation, `${context}, invocation ${invocationIndex + 1}`));
      }
      for (const result of run.results) {
        if (!result || typeof result.ruleId !== 'string' ||
            !(typeof result.message?.text === 'string' || typeof result.message?.markdown === 'string')) {
          throw new Error(`Malformed SARIF result: ${context}`);
        }
        if (result.baselineState === 'absent') continue;
        const location = result.locations?.[0]?.physicalLocation;
        findings.push(`${context}: ${result.ruleId} (${result.level ?? 'warning'}) ` +
          `${location?.artifactLocation?.uri ?? '?'}:${location?.region?.startLine ?? '?'}: ` +
          `${result.message.text ?? result.message.markdown}`);
      }
    }
  }
  if (diagnostics.length) throw new Error(`${diagnostics.length} incomplete CodeQL analysis diagnostic(s):\n${diagnostics.join('\n')}`);
  if (findings.length) throw new Error(`${findings.length} unresolved CodeQL finding(s):\n${findings.join('\n')}`);
  return reports.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    console.log(`CodeQL gate: ${checkCodeqlResults(process.argv[2] ?? 'codeql-results')} report(s), no unresolved findings`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
