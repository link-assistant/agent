import { runCommand, runStrict } from './run-command.mjs';

const DEFAULT_METADATA_PATHS = [
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  'js/package.json',
  'js/package-lock.json',
  'js/CHANGELOG.md',
];

function allowedMetadataPaths(extraPaths) {
  const allowed = new Set(DEFAULT_METADATA_PATHS);
  for (const path of extraPaths.split(/[\n,]/).map((value) => value.trim())) {
    if (path) {
      allowed.add(path);
    }
  }
  return allowed;
}

function isAllowedReleaseChange(status, path, allowed) {
  const consumedChangeset =
    status === 'D' &&
    /^(?:js\/)?\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path);
  const metadata = ['A', 'M'].includes(status) && allowed.has(path);
  return consumedChangeset || metadata;
}

function assertMetadataDiff(stdout, extraPaths) {
  const allowed = allowedMetadataPaths(extraPaths);
  const fields = stdout.split('\0').filter(Boolean);
  if (fields.length === 0 || fields.length % 2 !== 0) {
    throw new Error('Release commit has no valid metadata diff to attest.');
  }
  const unexpected = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!isAllowedReleaseChange(status, path, allowed)) {
      unexpected.push(`${status} ${path}`);
    }
  }
  if (unexpected.length > 0) {
    throw new Error(
      `Refusing to attest unvalidated release changes: ${unexpected.join(', ')}`
    );
  }
}

/** Prove that the new commit only changes version metadata. */
export async function assertReleaseMetadataOnly({
  runner = runCommand,
  parentSha = process.env.GITHUB_SHA,
  extraPaths = process.env.RELEASE_METADATA_PATHS || '',
  headRef = 'HEAD',
  logger = console,
} = {}) {
  if (!/^[0-9a-f]{40}$/i.test(parentSha || '')) {
    throw new Error(
      'A validated parent GITHUB_SHA is required for release attestation.'
    );
  }
  const strict = (args) => runStrict('git', args, { runner, logger });
  const headSha = (await strict(['rev-parse', headRef])).stdout.trim();
  const actualParent = (
    await strict(['rev-parse', `${headRef}^`])
  ).stdout.trim();
  if (actualParent !== parentSha) {
    throw new Error(
      `Release commit parent ${actualParent} differs from validated parent ${parentSha}.`
    );
  }

  const diff = await strict([
    'diff-tree',
    '--no-commit-id',
    '--no-renames',
    '--name-status',
    '-r',
    '-z',
    `${headRef}^`,
    headRef,
  ]);
  assertMetadataDiff(diff.stdout, extraPaths);
  return headSha;
}

/** Stage release metadata only; reject unrelated tracked edits. */
export async function stageReleaseMetadata({
  runner = runCommand,
  extraPaths = process.env.RELEASE_METADATA_PATHS || '',
  logger = console,
} = {}) {
  const strict = (args) => runStrict('git', args, { runner, logger });
  const diff = await strict([
    'diff',
    'HEAD',
    '--no-renames',
    '--name-status',
    '-z',
  ]);
  // New changelogs are not tracked yet. Ignore unrelated untracked files,
  // but include only explicitly allowed metadata additions.
  const untracked = await strict([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const allowed = allowedMetadataPaths(extraPaths);
  const additions = untracked.stdout
    .split('\0')
    .filter((path) => allowed.has(path));
  const changes =
    diff.stdout + additions.map((path) => `A\0${path}\0`).join('');
  assertMetadataDiff(changes, extraPaths);
  const fields = changes.split('\0').filter(Boolean);
  const deleted = [];
  const modified = [];
  for (let index = 0; index < fields.length; index += 2) {
    (fields[index] === 'D' ? deleted : modified).push(fields[index + 1]);
  }
  // Consumed changesets may already have been removed from the index.
  if (deleted.length) {
    await strict(['update-index', '--force-remove', '--', ...deleted]);
  }
  if (modified.length) {
    await strict(['add', '-A', '--', ...modified]);
  }
}
