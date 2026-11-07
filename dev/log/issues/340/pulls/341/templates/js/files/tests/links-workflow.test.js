import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';

const workflow = readFileSync('.github/workflows/links.yml', 'utf8').replaceAll(
  '\r\n',
  '\n'
);

function getStepBlock(stepName) {
  const lines = workflow.split('\n');
  const header = `      - name: ${stepName}`;
  const start = lines.findIndex((line) => line === header);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('      - ')
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

describe('broken link workflow', () => {
  it('fails for every nonzero Lychee exit even when an archive exists', () => {
    const failureStep = getStepBlock('Fail if broken links were found');

    expect(failureStep).toContain('!cancelled()');
    expect(failureStep).toContain('steps.lychee.outputs.exit_code != 0');
    expect(failureStep).not.toContain('steps.webarchive.outputs.all_archived');
    expect(failureStep).toContain(
      'An archive is a suggested replacement; it does not make the live link valid.'
    );
  });

  it('re-asks the links that never got an answer before giving up', () => {
    const recheckStep = getStepBlock('Re-check transient link failures');

    expect(recheckStep).toContain('id: recheck');
    expect(recheckStep).toContain('node scripts/recheck-broken-links.mjs');
    expect(recheckStep).toContain('if: steps.lychee.outputs.exit_code != 0');
    expect(recheckStep).toContain('LYCHEE_OUTPUT: lychee/out.md');
    expect(recheckStep).toContain('RECOVERED_OUTPUT: lychee/recovered.txt');
    expect(recheckStep).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
  });

  // `== 'false'` would read a skipped or crashed re-check as "nothing was
  // recovered" and skip the failure step on an empty output. Only the
  // negated form fails safe.
  it('downgrades a failure only when every unanswered link recovered', () => {
    const webarchiveStep = getStepBlock(
      'Check broken links against Web Archive'
    );
    const failureStep = getStepBlock('Fail if broken links were found');

    for (const step of [webarchiveStep, failureStep]) {
      expect(step).toContain("steps.recheck.outputs.all_recovered != 'true'");
      expect(step).not.toMatch(/all_recovered\s*==\s*'false'/);
    }
  });

  it('feeds the recovered list to the Web Archive check', () => {
    const webarchiveStep = getStepBlock(
      'Check broken links against Web Archive'
    );

    expect(webarchiveStep).toContain('RECOVERED_URLS: lychee/recovered.txt');
  });

  // The checker, the archive fallback, and the re-check run from files the
  // paths filters must name; otherwise editing them silently skips the link
  // check on the pull request that changed them.
  it('triggers on changes to every file the check depends on', () => {
    const expected = [
      '.lycheeignore',
      'scripts/check-web-archive.mjs',
      'scripts/recheck-broken-links.mjs',
      'tests/fixtures/lychee-report.md',
      'tests/links-workflow.test.js',
      'tests/recheck-broken-links.test.js',
    ];

    for (const trigger of ['push', 'pull_request']) {
      const triggerBlock = workflow.match(
        new RegExp(
          `^  ${trigger}:\\n(?:    .*\\n)*?    paths:\\n((?:      .*\\n)+)`,
          'm'
        )
      );

      expect(Boolean(triggerBlock)).toBe(true);

      for (const path of expected) {
        expect(triggerBlock[1]).toContain(`- '${path}'`);
      }
    }
  });

  // Without a schedule a link that dies after the last Markdown
  // edit stays undetected until an unrelated docs change trips over it.
  it('rechecks links weekly in addition to its change triggers', () => {
    const on = workflow.split('\n# ')[0];

    expect(on).toMatch(/^ {2}schedule:\n {4}- cron: '0 6 \* \* 1'$/m);
    for (const trigger of ['push', 'pull_request', 'workflow_dispatch']) {
      expect(on).toMatch(new RegExp(`^  ${trigger}:`, 'm'));
    }
  });

  // A per-commit key with a bare `cache-lychee-` restore prefix
  // restored caches days old, which lychee (--max-cache-age 1d) discarded
  // with "[WARN] Cache is too old" on almost every run.
  it('restores only a link cache saved on the same UTC day', () => {
    const dayStep = getStepBlock("Name today's link cache");
    const cacheStep = getStepBlock('Restore link cache');
    const lycheeStep = getStepBlock('Check links with lychee');
    const day = '${{ steps.link-cache.outputs.day }}';

    expect(dayStep).toContain('id: link-cache');
    expect(dayStep).toContain('echo "day=$(date -u +%F)" >> "$GITHUB_OUTPUT"');
    expect(cacheStep).toContain(
      `key: cache-lychee-\${{ runner.os }}-${day}-\${{ github.sha }}`
    );
    expect(cacheStep).toContain(
      `restore-keys: cache-lychee-\${{ runner.os }}-${day}-\n`
    );
    expect(cacheStep).not.toMatch(/restore-keys: cache-lychee-$/m);
    expect(lycheeStep).toContain('--max-cache-age 1d');
    expect(workflow.indexOf(dayStep)).toBeLessThan(workflow.indexOf(cacheStep));
  });
});
