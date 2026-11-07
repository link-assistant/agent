#!/usr/bin/env node

// Detect code changes for CI/CD pipeline
//
// Detects what types of files changed and outputs results for use in
// GitHub Actions workflow conditions.
//
// For PRs: GitHub Actions checks out a synthetic merge commit. When the
// push event carries before/after SHAs and the previous head verifiably
// passed this workflow, only the push range is diffed; otherwise the
// full PR diff against the base SHA is used, because a push can carry
// several commits and a superseded run may never have tested them.
// For merge commits pushed to main: compares HEAD^1 to HEAD (the full
// first-parent merge diff).
// For non-merge pushes: compares HEAD^ to HEAD.
// This lets PR synchronize runs skip slow checks when the pushed range
// is docs-only, while real merge pushes still evaluate the whole merge.
//
// Paths are compared package-relative: in a multi-language repository
// (package.json in js/) the js/ prefix is stripped first and files belonging
// to other languages are ignored, so the lists below match in both layouts.
//
// Ignored for every change-gating output:
// - .changeset/ folder (changeset metadata)
// - docs/case-studies/ folder (research documents)
// - dev/log/ folder (development logs)
// - experiments/ folder (experimental scripts)
// - examples/ folder (example scripts)
//
// Additionally excluded from code changes (don't require changesets):
// - Markdown files in any folder
// - docs/ folder (documentation)
//
// Outputs (written to GITHUB_OUTPUT):
//   js-changed, docs-changed, any-code-changed

import { execFileSync } from 'child_process';
import { appendFileSync } from 'fs';

import { getJsRoot, parseJsRootConfig } from './js-paths.mjs';

const ignoredPathPrefixes = [
  '.changeset/',
  'dev/log/',
  'docs/case-studies/',
  'examples/',
  'experiments/',
];

const workflowPathPrefix = '.github/workflows/';

/**
 * Path prefix of the JavaScript package relative to the repository root:
 * `js/` in a multi-language repository, `''` in a single-package one.
 *
 * `git diff --name-only` prints repository-root-relative paths, while the
 * ignore list is package-relative, so this prefix has to be stripped before
 * the two are compared.
 *
 * @returns {string} Prefix ending with `/`, or an empty string.
 */
function getPackagePathPrefix() {
  let jsRoot;
  try {
    jsRoot = getJsRoot({ jsRoot: parseJsRootConfig() });
  } catch {
    // No package.json anywhere: treat the repository root as the package root.
    return '';
  }
  return !jsRoot || jsRoot === '.' ? '' : `${jsRoot.replace(/\/+$/, '')}/`;
}

/**
 * Re-express repository-root-relative paths as package-relative ones.
 *
 * Files belonging to another language's package (`rust/Cargo.toml`) are
 * dropped, since they are not JavaScript code changes. Workflow files are
 * genuinely repository-root-relative and are kept as they are.
 *
 * @param {string[]} changedFiles Repository-root-relative paths.
 * @param {string} prefix Package prefix from {@link getPackagePathPrefix}.
 * @returns {string[]} Package-relative paths plus root-level workflow files.
 */
function toPackagePaths(changedFiles, prefix) {
  if (!prefix) {
    return changedFiles;
  }

  return changedFiles
    .filter(
      (file) => file.startsWith(prefix) || file.startsWith(workflowPathPrefix)
    )
    .map((file) =>
      file.startsWith(prefix) ? file.slice(prefix.length) : file
    );
}

function execGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.error(`Error executing command: git ${args.join(' ')}`);
    console.error(error.message);
    throw error;
  }
}

function splitChangedFiles(output) {
  return output ? output.split('\n').filter(Boolean) : [];
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

function isMergeCommit() {
  const parentCount = execGit(['cat-file', '-p', 'HEAD'])
    .split('\n')
    .filter((line) => line.startsWith('parent ')).length;
  return parentCount > 1;
}

function isPullRequestEvent() {
  return process.env.GITHUB_EVENT_NAME === 'pull_request';
}

/**
 * The before/after SHAs of the push that triggered this run, when they
 * describe a real push onto the PR branch. Branch creation reports the
 * zero SHA as `before`, which would make the range unusable.
 */
function getPushRange() {
  const beforeSha = process.env.GITHUB_BEFORE_SHA ?? '';
  const afterSha = process.env.GITHUB_AFTER_SHA ?? '';

  if (
    !beforeSha ||
    !afterSha ||
    /^0+$/.test(beforeSha) ||
    /^0+$/.test(afterSha)
  ) {
    return null;
  }
  return { beforeSha, afterSha };
}

function getWorkflowFile() {
  // GITHUB_WORKFLOW_REF looks like
  // owner/repo/.github/workflows/release.yml@refs/pull/1/merge
  const workflowRef = process.env.GITHUB_WORKFLOW_REF ?? '';
  const marker = '.github/workflows/';
  const markerIndex = workflowRef.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }
  const file = workflowRef
    .slice(markerIndex + marker.length)
    .split('@')[0]
    .trim();
  return file || null;
}

/**
 * Whether the previous head of the PR branch has a successful run of this
 * workflow recorded for it.
 *
 * Returns true when the Actions API reports one, false when it reports
 * none, and null whenever the answer cannot be trusted: missing context,
 * no token, a non-2xx response or an unparseable body. A null must widen
 * the diff, never narrow it.
 */
async function previousHeadWasTested(beforeSha) {
  const workflowFile = getWorkflowFile();
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';

  if (!workflowFile || !repository || !token) {
    console.log(
      'No workflow context to verify the previous head with; assuming unverified.'
    );
    return null;
  }

  const endpoint =
    `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/` +
    `${repository}/actions/workflows/${workflowFile}/runs` +
    `?head_sha=${beforeSha}&status=success&per_page=1`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      console.log(
        `Workflow run lookup returned ${response.status}; the previous head stays unverified.`
      );
      return null;
    }

    const body = await response.json();

    if (typeof body?.total_count !== 'number') {
      console.log(
        'Workflow run lookup returned an unexpected body; the previous head stays unverified.'
      );
      return null;
    }
    return body.total_count > 0;
  } catch (error) {
    console.log(
      `Workflow run lookup failed (${error?.message ?? error}); the previous head stays unverified.`
    );
    return null;
  }
}

/**
 * The git arguments describing what a pull_request run must evaluate.
 *
 * The push range (before..after) is only honest when the previous head
 * actually passed this workflow: a superseded run means those commits
 * were never tested, so the range widens to the full PR diff. With no
 * base SHA to widen to, the push range is kept - unverified is not
 * known-untested, and a one-commit fallback would narrow the coverage.
 */
async function getPullRequestDiffArgs() {
  const pushRange = getPushRange();
  const baseSha = process.env.GITHUB_BASE_SHA ?? '';

  if (!pushRange) {
    if (baseSha) {
      console.log(`Comparing ${baseSha} to HEAD^2 (full PR diff)`);
      return ['diff', '--name-only', baseSha, 'HEAD^2'];
    }
    return null;
  }

  const { beforeSha, afterSha } = pushRange;
  const previousHeadTested = await previousHeadWasTested(beforeSha);

  if (previousHeadTested !== true && baseSha) {
    if (previousHeadTested === false) {
      console.log(
        'The previous head has no successful run of this workflow; comparing the full PR diff.'
      );
    }
    console.log(`Comparing ${baseSha} to HEAD^2 (full PR diff)`);
    return ['diff', '--name-only', baseSha, 'HEAD^2'];
  }

  console.log(`Comparing ${beforeSha} to ${afterSha} (push range)`);
  return ['diff', '--name-only', beforeSha, afterSha];
}

function getChangedFiles() {
  const mergeCommit = isMergeCommit();

  // GitHub Actions checks out a synthetic merge commit for pull_request
  // events: HEAD is the merge commit, HEAD^ is the base branch, HEAD^2
  // is the actual PR head. The range to diff depends on what the push
  // carried and whether the previous head was verifiably tested.
  // For push events, merge commits need the first-parent diff so the full
  // branch merge is evaluated, not only the PR head's final commit.
  if (mergeCommit && isPullRequestEvent()) {
    return getPullRequestDiffArgs().then((diffArgs) => {
      if (!diffArgs) {
        console.log('Comparing HEAD^2^ to HEAD^2 (per-commit diff of PR head)');
        try {
          return splitChangedFiles(
            execGit(['diff', '--name-only', 'HEAD^2^', 'HEAD^2'])
          );
        } catch {
          console.log(
            'HEAD^2^ not available (first commit in PR), listing files in HEAD^2'
          );
          return splitChangedFiles(
            execGit(['diff', '--name-only', 'HEAD^', 'HEAD^2'])
          );
        }
      }
      return splitChangedFiles(execGit(diffArgs));
    });
  }

  if (mergeCommit) {
    console.log('Merge commit detected (push event)');
    console.log('Comparing HEAD^1 to HEAD (first-parent merge diff)');
    return splitChangedFiles(
      execGit(['diff', '--name-only', 'HEAD^1', 'HEAD'])
    );
  }

  console.log('Comparing HEAD^ to HEAD');
  try {
    return splitChangedFiles(execGit(['diff', '--name-only', 'HEAD^', 'HEAD']));
  } catch {
    console.log('HEAD^ not available, listing all files in HEAD');
    return splitChangedFiles(execGit(['ls-tree', '--name-only', '-r', 'HEAD']));
  }
}

/**
 * Everything else counts as code, so a file type nobody listed (a shell
 * script, a type declaration, the Dockerfile) still runs the checks.
 *
 * @param {string} filePath package-relative path
 * @returns {boolean}
 */
function isExcludedFromCodeChanges(filePath) {
  if (filePath.endsWith('.md') || filePath.endsWith('/.gitkeep')) {
    return true;
  }

  return filePath.startsWith('docs/') || filePath === '.gitkeep';
}

async function detectChanges() {
  console.log('Detecting file changes for CI/CD...\n');

  const changedFiles = await getChangedFiles();

  console.log('Changed files:');
  if (changedFiles.length === 0) {
    console.log('  (none)');
  } else {
    changedFiles.forEach((file) => console.log(`  ${file}`));
  }
  console.log('');

  const packageChangedFiles = toPackagePaths(
    changedFiles,
    getPackagePathPrefix()
  );

  const relevantChangedFiles = packageChangedFiles.filter(
    (file) => !ignoredPathPrefixes.some((prefix) => file.startsWith(prefix))
  );

  const jsChanged = relevantChangedFiles.some((file) =>
    /\.(mjs|cjs|js)$/.test(file)
  );
  setOutput('js-changed', jsChanged ? 'true' : 'false');

  const docsChanged = relevantChangedFiles.some((file) => file.endsWith('.md'));
  setOutput('docs-changed', docsChanged ? 'true' : 'false');

  const codeChangedFiles = relevantChangedFiles.filter(
    (file) => !isExcludedFromCodeChanges(file)
  );

  console.log('\nFiles considered as code changes:');
  if (codeChangedFiles.length === 0) {
    console.log('  (none)');
  } else {
    codeChangedFiles.forEach((file) => console.log(`  ${file}`));
  }
  console.log('');

  const anyCodeChanged = codeChangedFiles.length > 0;
  setOutput('any-code-changed', anyCodeChanged ? 'true' : 'false');

  console.log('\nChange detection completed.');
}

// Run the detection
detectChanges().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
