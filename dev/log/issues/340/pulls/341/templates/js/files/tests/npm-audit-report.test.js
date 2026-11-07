import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';

import {
  classify,
  collectAdvisories,
  isNonBreakingFix,
  main,
  report,
} from '../scripts/npm-audit-report.mjs';

// Real `npm audit --package-lock-only --json` output for the artifact SDK lock
// when the moderate minimatch advisory was open: one moderate advisory reached through four
// dependents, none with a non-breaking fix.
const moderate = readFileSync('tests/fixtures/npm-audit-moderate.json', 'utf8');

const advisory = (name, severity, ghsa, range = '<2.0.0') => ({
  source: 1,
  name,
  dependency: name,
  title: `${name} advisory`,
  url: `https://github.com/advisories/${ghsa}`,
  severity,
  range,
});

const synthetic = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    fixable: {
      name: 'fixable',
      severity: 'moderate',
      via: [advisory('fixable', 'moderate', 'GHSA-fixa-ble0-0001')],
      fixAvailable: true,
    },
    minor: {
      name: 'minor',
      severity: 'low',
      via: [advisory('minor', 'low', 'GHSA-mino-r000-0002')],
      fixAvailable: { name: 'minor', version: '1.2.3', isSemVerMajor: false },
    },
    severe: {
      name: 'severe',
      severity: 'high',
      via: [advisory('severe', 'high', 'GHSA-seve-re00-0003')],
      fixAvailable: false,
    },
  },
});

const withoutHigh = JSON.stringify({
  ...JSON.parse(synthetic),
  vulnerabilities: {
    fixable: JSON.parse(synthetic).vulnerabilities.fixable,
  },
});

describe('npm audit report', () => {
  it('reports each advisory once, not once per dependent package', () => {
    const advisories = collectAdvisories(JSON.parse(moderate));
    expect(advisories.map(({ id }) => id)).toEqual(['GHSA-g3hv-75wg-m249']);
    expect(advisories[0].severity).toBe('moderate');
    expect(advisories[0].fixable).toBe(false);
  });

  it('keeps a green high gate but names the moderate advisory it accepted', () => {
    const result = report(moderate, {
      directory: '.github/actions/artifact-transport',
    });
    expect(result.failed).toBe(false);
    expect(result.annotations.length).toBe(1);
    expect(result.annotations[0]).toMatch(
      /^::warning title=npm audit \(\.github\/actions\/artifact-transport\)::GHSA-g3hv-75wg-m249 \[moderate\]/
    );
    expect(result.annotations[0]).toContain('accepted, this job fails at high');
    expect(result.summary).toContain('| moderate |');
    expect(result.summary).toContain('0 fail this job');
  });

  it('fails at the configured level and annotates the blocking advisory as an error', () => {
    const result = report(synthetic, {});
    expect(result.failed).toBe(true);
    expect(result.annotations[0]).toMatch(
      /^::error title=[^:]+::GHSA-seve-re00-0003 \[high\]/
    );
    expect(
      result.annotations.slice(1).every((line) => line.startsWith('::warning'))
    ).toBe(true);
    expect(report(withoutHigh, {}).failed).toBe(false);
  });

  it('fails the scheduled run on a moderate advisory only when a non-breaking fix exists', () => {
    const scheduled = { level: 'high', fixableLevel: 'moderate' };
    expect(report(withoutHigh, scheduled).failed).toBe(true);
    expect(report(moderate, scheduled).failed).toBe(false);
    const blocking = classify(
      collectAdvisories(JSON.parse(synthetic)),
      scheduled
    )
      .filter((entry) => entry.blocking)
      .map((entry) => entry.id);
    // The low advisory has a fix, but sits below the fixable level.
    expect(blocking).toEqual(['GHSA-seve-re00-0003', 'GHSA-fixa-ble0-0001']);
  });

  it('treats only a fix without --force as non-breaking', () => {
    expect(isNonBreakingFix(true)).toBe(true);
    expect(isNonBreakingFix({ isSemVerMajor: false })).toBe(true);
    expect(isNonBreakingFix({ isSemVerMajor: true })).toBe(false);
    expect(isNonBreakingFix(false)).toBe(false);
  });

  it('fails closed when npm cannot produce a report', () => {
    expect(() =>
      report(JSON.stringify({ error: { code: 'ENOAUDIT', summary: 'down' } }))
    ).toThrow('npm audit failed: ENOAUDIT: down');
    expect(() => report('npm ERR! network')).toThrow('not JSON');
    expect(() => report('{}')).toThrow('no vulnerabilities map');
    const lines = [];
    const log = console.log;
    console.log = (line) => lines.push(line);
    try {
      expect(main({}, () => ({ status: 0, stdout: '' }))).toBe(1);
      expect(
        main({ AUDIT_LEVEL: 'severe' }, () => ({ status: 1, stdout: moderate }))
      ).toBe(1);
      expect(main({}, () => ({ status: 1, stdout: moderate }))).toBe(0);
    } finally {
      console.log = log;
    }
    expect(lines[0]).toMatch(
      /^::error title=npm audit \(\.\)::npm audit output is not JSON/
    );
    expect(lines[1]).toContain('Unknown severity: severe');
  });

  it('rejects execution failures even when stdout contains a clean report', () => {
    const stdout = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {},
    });
    const log = console.log;
    const lines = [];
    console.log = (line) => lines.push(line);
    try {
      for (const execution of [
        { status: 2 },
        { status: null, signal: 'SIGTERM' },
        { status: 1 },
      ]) {
        expect(main({}, () => ({ stdout, ...execution }))).toBe(1);
      }
      expect(main({}, () => ({ status: 0, stdout }))).toBe(0);
    } finally {
      console.log = log;
    }
    expect(lines.slice(0, 3).every((line) => line.startsWith('::error'))).toBe(
      true
    );
  });

  it('rejects malformed vulnerability maps and unresolved advisory references', () => {
    for (const vulnerabilities of [
      [],
      { vulnerable: null },
      { vulnerable: { name: 'vulnerable', severity: 'high' } },
      { vulnerable: { severity: 'high', via: [] } },
      { vulnerable: { severity: 'high', via: ['missing-package'] } },
      { vulnerable: { severity: 'high', via: ['vulnerable'] } },
    ]) {
      expect(() => report(JSON.stringify({ vulnerabilities }))).toThrow();
    }
  });

  it('keeps workflow command data on one line', () => {
    const multiline = JSON.parse(withoutHigh);
    multiline.vulnerabilities.fixable.via[0].title = 'a\nb 100%';
    const [line] = report(JSON.stringify(multiline)).annotations;
    expect(line).toContain('a%0Ab 100%25');
  });
});

describe('independent npm audit evidence chains', () => {
  it('rejects a reference-only cycle even beside an unrelated valid advisory', () => {
    const data = JSON.parse(withoutHigh);
    data.vulnerabilities.a = { severity: 'high', via: ['b'] };
    data.vulnerabilities.b = { severity: 'high', via: ['a'] };
    expect(() => report(JSON.stringify(data))).toThrow('reference-only cycle');
  });
  for (const via of [
    {},
    { severity: 'high' },
    {
      severity: 'high',
      title: '',
      name: 'x',
      range: '*',
      url: 'https://example.com/advisory',
    },
  ]) {
    it(`rejects incomplete advisory evidence ${JSON.stringify(via)}`, () => {
      expect(() =>
        report(
          JSON.stringify({
            vulnerabilities: { x: { severity: 'high', via: [via] } },
          })
        )
      ).toThrow();
    });
  }
});
