import { describe, it, expect } from 'test-anywhere';
import { readFileSync, readdirSync } from 'node:fs';

const WORKFLOW_DIRECTORY = '.github/workflows';
// GitHub documents `queue` although actionlint 1.7.12 does not know it yet:
// https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
const SUPPORTED_CONCURRENCY_KEYS = new Set([
  'group',
  'cancel-in-progress',
  'queue',
]);

function readWorkflow(filePath) {
  return readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
}

function listWorkflowPaths() {
  return readdirSync(WORKFLOW_DIRECTORY)
    .filter((fileName) => /\.ya?ml$/.test(fileName))
    .map((fileName) => `${WORKFLOW_DIRECTORY}/${fileName}`);
}

function getUnsupportedConcurrencyKeys(workflow) {
  const lines = workflow.split('\n');
  const unsupportedKeys = [];

  for (let index = 0; index < lines.length; index += 1) {
    const concurrency = lines[index].match(/^(\s*)concurrency:\s*$/);

    if (!concurrency) {
      continue;
    }

    const keyIndentation = concurrency[1].length + 2;

    for (const line of lines.slice(index + 1)) {
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        continue;
      }

      const indentation = line.match(/^\s*/)[0].length;

      if (indentation <= concurrency[1].length) {
        break;
      }

      if (indentation !== keyIndentation) {
        continue;
      }

      const key = line.trimStart().match(/^([a-zA-Z0-9_-]+):/)?.[1];

      if (key && !SUPPORTED_CONCURRENCY_KEYS.has(key)) {
        unsupportedKeys.push(key);
      }
    }
  }

  return unsupportedKeys;
}

function getJobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const jobHeader = `  ${jobName}:`;
  const start = lines.findIndex((line) => line === jobHeader);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function getMultilineIfExpression(jobBlock) {
  const lines = jobBlock.split('\n');
  const start = lines.findIndex((line) => line === '    if: |');

  if (start === -1) {
    return '';
  }

  const expressionLines = [];

  for (const line of lines.slice(start + 1)) {
    if (/^[ ]{4}\S/.test(line)) {
      break;
    }

    expressionLines.push(line.slice(6));
  }

  return expressionLines.join('\n').trim();
}

function evaluateWorkflowIf(expression, context) {
  const javaScriptExpression = expression
    .replaceAll(
      "contains(needs.*.result, 'failure')",
      "Object.values(context.needs).some((job) => job.result === 'failure')"
    )
    .replaceAll(
      "contains(needs.*.result, 'cancelled')",
      "Object.values(context.needs).some((job) => job.result === 'cancelled')"
    )
    .replaceAll('!cancelled()', '!context.cancelled')
    .replaceAll('github.event_name', 'context.github.event_name')
    .replaceAll(
      'github.event.inputs.release_mode',
      'context.github.event.inputs.release_mode'
    )
    .replace(
      /needs\.([a-zA-Z0-9_-]+)\.outputs\.([a-zA-Z0-9_-]+)/g,
      'context.needs["$1"].outputs["$2"]'
    )
    .replace(/needs\.([a-zA-Z0-9_-]+)\.result/g, 'context.needs["$1"].result');

  return Function(
    'context',
    `"use strict"; return (${javaScriptExpression});`
  )(context);
}

function expectOrdered(text, markers) {
  let lastIndex = -1;

  for (const marker of markers) {
    const index = text.indexOf(marker);
    expect(index).toBeGreaterThan(lastIndex);
    lastIndex = index;
  }
}

function expectMainWriterConcurrency(jobBlock) {
  expect(jobBlock).toContain(
    '    concurrency:\n      group: main-writer-${{ github.repository }}-main\n      cancel-in-progress: false\n      queue: max'
  );
}

function expectCancellableCheckConcurrency(
  jobBlock,
  jobName,
  matrixSuffix = '',
  cancelInProgress = 'true'
) {
  expect(jobBlock).toContain(
    `    concurrency:\n      group: check-\${{ github.workflow }}-\${{ github.ref }}-${jobName}${matrixSuffix}\n      cancel-in-progress: ${cancelInProgress}`
  );
}

function createTestJobContext({
  eventName = 'pull_request',
  releaseMode,
  outputs = {},
  result = 'skipped',
} = {}) {
  return {
    cancelled: false,
    github: {
      event_name: eventName,
      event: {
        inputs: {
          release_mode: releaseMode,
        },
      },
    },
    needs: {
      'detect-changes': {
        outputs: {
          'any-code-changed': 'false',
          'js-changed': 'false',
          'docs-changed': 'false',
          ...outputs,
        },
      },
      'changeset-check': { result },
      'test-compilation': { result },
      lint: { result },
      'check-file-line-limits': { result },
      'release-preflight': { result: 'success' },
    },
  };
}

describe('workflow concurrency policy', () => {
  it('detects unsupported keys in a concurrency block', () => {
    const invalidWorkflow = [
      'jobs:',
      '  publish:',
      '    concurrency:',
      '      group: main-writer',
      '      cancel-in-progress: false',
      '      queue: max',
      '      cancel-in-flight: true',
      '    steps: []',
    ].join('\n');

    expect(getUnsupportedConcurrencyKeys(invalidWorkflow)).toEqual([
      'cancel-in-flight',
    ]);
  });

  it('keeps every waiting main writer in the queue', () => {
    // With the default `queue: single`, a third writer that starts waiting
    // cancels the one already waiting, so a due release ends up cancelled.
    const writers = [];

    for (const workflowPath of listWorkflowPaths()) {
      const blocks = readWorkflow(workflowPath).split(/\n {4}concurrency:\n/);

      for (const block of blocks.slice(1)) {
        const settings = block.split(/\n(?! {6})/)[0];

        if (settings.includes('group: main-writer-')) {
          writers.push(settings);
          expect(settings).toContain('cancel-in-progress: false');
          expect(settings).toContain('queue: max');
        }
        // GitHub rejects the workflow when a queue may also cancel.
        if (settings.includes('queue: max')) {
          expect(settings).not.toContain('cancel-in-progress: true');
        }
      }
    }

    expect(writers.length).toBe(7);
  });

  it('uses only keys supported by GitHub Actions', () => {
    const violations = [];

    for (const workflowPath of listWorkflowPaths()) {
      const workflow = readWorkflow(workflowPath);

      for (const key of getUnsupportedConcurrencyKeys(workflow)) {
        violations.push(`${workflowPath}: ${key}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('uses job-level concurrency so stale checks cannot cancel active writers', () => {
    const workflowPaths = [
      '.github/workflows/example-app.yml',
      '.github/workflows/release.yml',
      '.github/workflows/links.yml',
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = readWorkflow(workflowPath);

      expect(workflow).not.toMatch(/^concurrency:/m);
    }

    const releaseWorkflow = readWorkflow('.github/workflows/release.yml');
    const exampleAppWorkflow = readWorkflow(
      '.github/workflows/example-app.yml'
    );
    const linksWorkflow = readWorkflow('.github/workflows/links.yml');

    for (const jobName of [
      'detect-changes',
      'test-compilation',
      'check-file-line-limits',
      'version-check',
      'changeset-check',
      'lint',
      'docker-build',
      'validate-docs',
    ]) {
      expectCancellableCheckConcurrency(
        getJobBlock(releaseWorkflow, jobName),
        jobName,
        '',
        "${{ github.ref != 'refs/heads/main' }}"
      );
    }
    expectCancellableCheckConcurrency(
      getJobBlock(releaseWorkflow, 'test'),
      'test',
      '-${{ matrix.runtime }}-${{ matrix.os }}',
      "${{ github.ref != 'refs/heads/main' }}"
    );

    for (const jobName of ['web-build', 'android-build', 'ios-build']) {
      expectCancellableCheckConcurrency(
        getJobBlock(exampleAppWorkflow, jobName),
        jobName
      );
    }
    expectCancellableCheckConcurrency(
      getJobBlock(exampleAppWorkflow, 'desktop-package'),
      'desktop-package',
      '-${{ matrix.os }}'
    );
    expectCancellableCheckConcurrency(
      getJobBlock(linksWorkflow, 'link-checker'),
      'link-checker'
    );
  });
});

describe('workflow reliability policy', () => {
  it('sets Git default branch config before checkout initializes repositories', () => {
    const workflowPaths = [
      '.github/workflows/example-app.yml',
      '.github/workflows/release.yml',
      '.github/workflows/links.yml',
    ];
    const gitDefaultBranchEnv = [
      'env:',
      "  GIT_CONFIG_COUNT: '1'",
      '  GIT_CONFIG_KEY_0: init.defaultBranch',
      '  GIT_CONFIG_VALUE_0: main',
    ].join('\n');

    for (const workflowPath of workflowPaths) {
      const workflow = readWorkflow(workflowPath);
      expect(workflow).toContain(gitDefaultBranchEnv);
      expectOrdered(workflow, [
        'workflow_dispatch:',
        gitDefaultBranchEnv,
        'jobs:',
        '- uses: actions/checkout@v7',
      ]);
    }
  });

  it('excludes Vite source HTML from raw lychee file scans', () => {
    const linksWorkflow = readWorkflow('.github/workflows/links.yml');
    const viteSourceHtmlPath = 'examples/universal-app/index.html';
    const viteSourceHtml = readWorkflow(viteSourceHtmlPath);

    expect(viteSourceHtml).toContain('href="/favicon.svg"');
    expect(viteSourceHtml).toContain('src="/src/main.js"');
    expect(linksWorkflow).toContain(`--exclude-path ${viteSourceHtmlPath}`);
    expectOrdered(linksWorkflow, [
      '--hidden',
      '--extensions md,html',
      '--exclude-path docs/case-studies',
      '--exclude-path dev/log',
      `--exclude-path ${viteSourceHtmlPath}`,
      '--exclude-path tests/fixtures',
      '\n            .',
    ]);
  });

  it('uploads preview regeneration artifacts when screenshot rendering fails', () => {
    const exampleAppWorkflow = readWorkflow(
      '.github/workflows/example-app.yml'
    );
    const previewRegenJob = getJobBlock(exampleAppWorkflow, 'preview-regen');

    expect(previewRegenJob).toContain(
      'name: Upload screenshot failure artifacts'
    );
    expect(previewRegenJob).toContain('if: failure()');
    expect(previewRegenJob).toContain(
      'uses: ./.github/actions/artifact-transport'
    );
    expect(previewRegenJob).toContain(
      'name: preview-regen-failure-${{ github.run_id }}'
    );
    expect(previewRegenJob).toContain('path: docs/screenshots/example-app/');
    expect(previewRegenJob).not.toContain('web/test-results/');
    expect(previewRegenJob).not.toContain('web/playwright-report/');
    expect(previewRegenJob).toContain('retention-days: 7');
    expect(previewRegenJob).toContain('if-no-files-found: error');
  });

  it('uses the official Playwright image for preview regeneration with browser downloads disabled', () => {
    const exampleAppWorkflow = readWorkflow(
      '.github/workflows/example-app.yml'
    );
    const previewRegenJob = getJobBlock(exampleAppWorkflow, 'preview-regen');
    const imageVersion = previewRegenJob.match(
      /image:\s*mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64} # v([0-9.]+)-noble/
    )?.[1];
    const packageVersion = previewRegenJob.match(/playwright@([0-9.]+)/)?.[1];

    expect(previewRegenJob).toContain('container:');
    expect(imageVersion).toBe('1.59.1');
    expect(packageVersion).toBe(imageVersion);
    expect(previewRegenJob).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'");
    expect(previewRegenJob).not.toContain('npx playwright install');
    expect(previewRegenJob).not.toContain('~/.cache/ms-playwright');
  });
});

describe('workflow artifact and writer reliability', () => {
  it('serializes main writers and retries generated pushes after rebasing', () => {
    const exampleAppWorkflow = readWorkflow(
      '.github/workflows/example-app.yml'
    );
    const releaseWorkflow = readWorkflow('.github/workflows/release.yml');
    const pushHelper = readWorkflow('scripts/push-main-with-rebase-retry.mjs');
    const versionAndCommit = readWorkflow('scripts/version-and-commit.mjs');
    const previewRegenJob = getJobBlock(exampleAppWorkflow, 'preview-regen');
    const releaseJob = getJobBlock(releaseWorkflow, 'release');
    const instantReleaseJob = getJobBlock(releaseWorkflow, 'instant-release');
    const dockerPublishJob = getJobBlock(releaseWorkflow, 'docker-publish');
    const changesetPrJob = getJobBlock(releaseWorkflow, 'changeset-pr');
    const pagesDeployJob = getJobBlock(exampleAppWorkflow, 'pages-deploy');

    expectMainWriterConcurrency(previewRegenJob);
    expectMainWriterConcurrency(pagesDeployJob);
    expectMainWriterConcurrency(releaseJob);
    expectMainWriterConcurrency(instantReleaseJob);
    expectMainWriterConcurrency(dockerPublishJob);
    expectMainWriterConcurrency(changesetPrJob);
    expect(previewRegenJob).toContain(
      'node scripts/push-main-with-rebase-retry.mjs'
    );
    expect(previewRegenJob).not.toContain('git push origin HEAD:main');
    expect(versionAndCommit).toContain(
      'node scripts/push-main-with-rebase-retry.mjs'
    );
    expect(versionAndCommit).not.toContain('git push origin main');
    expect(pushHelper).toContain("['push', remote, `HEAD:${branch}`]");
    expect(pushHelper).toContain("'pull', '--rebase', remote, branch");
    // A ruleset rejection is not a lost race: it must reach the pull-request
    // fallback, never a rebase and retry
    // (link-foundation/js-ai-driven-development-pipeline-template#143).
    expect(pushHelper).toContain('isBlockedByRepositoryRule');
    expect(pushHelper).toContain('landViaPullRequest');
    expect(releaseJob).toContain(
      'RELEASE_PR_TOKEN: ${{ secrets.RELEASE_PR_TOKEN }}'
    );
    expect(instantReleaseJob).toContain(
      'RELEASE_PR_TOKEN: ${{ secrets.RELEASE_PR_TOKEN }}'
    );
    expect(previewRegenJob).toContain(
      'RELEASE_PR_TOKEN: ${{ secrets.RELEASE_PR_TOKEN }}'
    );
    expect(previewRegenJob).toContain('gh auth setup-git');
    expect(previewRegenJob).not.toContain('preview images [skip ci]');
    expect(changesetPrJob).toContain('token: ${{ secrets.RELEASE_PR_TOKEN }}');
    expect(changesetPrJob).toContain(
      'RELEASE_PR_TOKEN is required to create a changeset pull request'
    );
    // The push helper exits non-zero only when it could not land the commit
    // through any of its strategies; with errexit on, that exit arrives as a
    // rejection, not a result code, so a swallowed push failure cannot report
    // a version that only exists in the runner as released.
    expect(versionAndCommit).toContain('Failed to push version');
    expect(versionAndCommit).not.toContain('pushResult.code !== 0');
  });

  it('verifies desktop package output before uploading artifacts', () => {
    const exampleAppWorkflow = readWorkflow(
      '.github/workflows/example-app.yml'
    );
    const desktopPackageJob = getJobBlock(
      exampleAppWorkflow,
      'desktop-package'
    );
    const packageStepIndex = desktopPackageJob.indexOf(
      'name: Package Electron app'
    );
    const uploadStepIndex = desktopPackageJob.indexOf(
      'name: Upload desktop package'
    );

    expect(packageStepIndex).toBeGreaterThanOrEqual(0);
    expect(uploadStepIndex).toBeGreaterThan(packageStepIndex);
    expect(desktopPackageJob).toContain("node-version: '24.x'");
    expect(desktopPackageJob).not.toContain("node-version: '20.x'");
    expect(desktopPackageJob).toContain('shell: bash');
    expect(desktopPackageJob).toContain('npm run example:desktop:package');
    expect(desktopPackageJob).toContain('find examples/universal-app/out');
    expect(desktopPackageJob).toContain(
      'Desktop package output was not created at examples/universal-app/out'
    );
    expect(desktopPackageJob).toContain('if-no-files-found: error');
  });
});

describe('release workflow change gates', () => {
  it('skips the slow test matrix for pull requests with no code changes', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const testJob = getJobBlock(workflow, 'test');
    const testCondition = getMultilineIfExpression(testJob);
    const nonCodePullRequest = createTestJobContext();

    expect(evaluateWorkflowIf(testCondition, nonCodePullRequest)).toBe(false);
  });

  it('runs the slow test matrix for workflow changes after fast checks pass', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const testJob = getJobBlock(workflow, 'test');
    const testCondition = getMultilineIfExpression(testJob);
    const workflowPullRequest = createTestJobContext({
      outputs: {
        'any-code-changed': 'true',
      },
      result: 'success',
    });

    expect(evaluateWorkflowIf(testCondition, workflowPullRequest)).toBe(true);
  });

  for (const jobName of [
    'test-compilation',
    'check-file-line-limits',
    'lint',
    'test',
    'validate-docs',
  ]) {
    it(`skips ${jobName} for excluded-only pushes`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);
      const condition = getMultilineIfExpression(job);
      const excludedOnlyPush = createTestJobContext({ eventName: 'push' });

      expect(evaluateWorkflowIf(condition, excludedOnlyPush)).toBe(false);
    });
  }
});

describe('manual release quality gates', () => {
  function getManualReleaseContext({
    releaseMode,
    lintResult = 'success',
    testResult = 'success',
    cancelled = false,
  }) {
    const context = createTestJobContext({
      eventName: 'workflow_dispatch',
      releaseMode,
      result: 'skipped',
    });

    context.cancelled = cancelled;
    context.needs.lint.result = lintResult;
    context.needs.test = { result: testResult };
    return context;
  }

  it('runs lint and tests before an instant manual release', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const lintJob = getJobBlock(workflow, 'lint');
    const testJob = getJobBlock(workflow, 'test');
    const instantReleaseJob = getJobBlock(workflow, 'instant-release');
    const context = getManualReleaseContext({ releaseMode: 'instant' });

    expect(evaluateWorkflowIf(getMultilineIfExpression(lintJob), context)).toBe(
      true
    );
    expect(evaluateWorkflowIf(getMultilineIfExpression(testJob), context)).toBe(
      true
    );
    expect(instantReleaseJob).toContain('        release-preflight,');
    expect(
      evaluateWorkflowIf(getMultilineIfExpression(instantReleaseJob), context)
    ).toBe(true);
  });

  it('blocks an instant manual release after either quality gate fails', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const condition = getMultilineIfExpression(
      getJobBlock(workflow, 'instant-release')
    );

    expect(
      evaluateWorkflowIf(
        condition,
        getManualReleaseContext({
          releaseMode: 'instant',
          lintResult: 'failure',
        })
      )
    ).toBe(false);
    expect(
      evaluateWorkflowIf(
        condition,
        getManualReleaseContext({
          releaseMode: 'instant',
          testResult: 'failure',
        })
      )
    ).toBe(false);
  });

  it('waits for successful lint before creating a manual changeset PR', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const changesetPrJob = getJobBlock(workflow, 'changeset-pr');
    const condition = getMultilineIfExpression(changesetPrJob);

    expect(changesetPrJob).toContain('    needs: [lint]');
    expect(
      evaluateWorkflowIf(
        condition,
        getManualReleaseContext({ releaseMode: 'changeset-pr' })
      )
    ).toBe(true);
    expect(
      evaluateWorkflowIf(
        condition,
        getManualReleaseContext({
          releaseMode: 'changeset-pr',
          lintResult: 'failure',
        })
      )
    ).toBe(false);
  });

  for (const jobName of ['instant-release', 'changeset-pr']) {
    it(`does not run ${jobName} after cancellation`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const condition = getMultilineIfExpression(
        getJobBlock(workflow, jobName)
      );
      const releaseMode =
        jobName === 'instant-release' ? 'instant' : 'changeset-pr';

      expect(
        evaluateWorkflowIf(
          condition,
          getManualReleaseContext({ releaseMode, cancelled: true })
        )
      ).toBe(false);
    });
  }
});

describe('npm publish token bootstrap', () => {
  // The first publish of a brand-new package cannot use OIDC trusted publishing
  // (npm returns E404 because a trusted publisher can only be configured for an
  // existing package). Every Publish-to-npm step must therefore expose an
  // optional NODE_AUTH_TOKEN fallback sourced from secrets.NPM_TOKEN.
  for (const jobName of ['release', 'instant-release']) {
    it(`passes secrets.NPM_TOKEN as NODE_AUTH_TOKEN on the ${jobName} publish step`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);

      expect(job).toContain('node scripts/publish-to-npm.mjs');
      expect(job).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
    });
  }
});

describe('npm user config cleanup', () => {
  for (const jobName of ['release', 'instant-release']) {
    it(`removes deprecated always-auth before npm commands in the ${jobName} job`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);

      expectOrdered(job, [
        'uses: actions/setup-node@v7',
        '- name: Remove deprecated npm auth config',
        '- name: Install dependencies',
      ]);
      expect(job).toContain('run: node scripts/sanitize-npm-userconfig.mjs');
    });
  }
});

describe('install-from-package smoke test', () => {
  for (const jobName of ['release', 'instant-release']) {
    it(`smoke-tests the published npm package in the ${jobName} job`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);

      expectOrdered(job, [
        '- name: Publish to npm',
        '- name: Smoke-test published npm package',
        '- name: Create GitHub Release',
      ]);
      // The version reaches the smoke test through an environment variable,
      // never through an inline template expression in the run block.
      expectOrdered(job, [
        'PACKAGE_VERSION: ${{ steps.publish.outputs.published_version }}',
        'node scripts/smoke-test-package.mjs --package-version "$PACKAGE_VERSION"',
      ]);
    });
  }
});
