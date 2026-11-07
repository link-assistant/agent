import { posix } from 'node:path';
import { assertReleaseMetadataOnly } from './release-metadata.mjs';
import {
  assertVersionOnlyChanges,
  validateVersionTree,
} from './version-lock.mjs';
import { runCommand, runStrict } from './run-command.mjs';

/** Accept the validated commit or its version-only child, with the same dependencies. */
export async function assertValidatedRelease({
  parentSha = process.env.GITHUB_SHA,
  headRef = 'HEAD',
  jsRoot = '.',
  runner = runCommand,
  logger = console,
} = {}) {
  const strict = (args) => runStrict('git', args, { runner, logger });
  const headSha = (await strict(['rev-parse', headRef])).stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(parentSha || '')) {
    throw new Error('A validated GITHUB_SHA is required before publication.');
  }
  if (headSha === parentSha) {
    return headSha;
  }
  await assertReleaseMetadataOnly({ parentSha, headRef, runner, logger });
  const readTree = async (ref) => {
    const read = async (name) =>
      JSON.parse(
        (await strict(['show', `${ref}:${posix.join(jsRoot, name)}`])).stdout
      );
    const tree = {
      manifest: await read('package.json'),
      lock: await read('package-lock.json'),
    };
    validateVersionTree(tree);
    return tree;
  };
  assertVersionOnlyChanges(await readTree(parentSha), await readTree(headSha));
  return headSha;
}

/** Fetching verifies the version landed; publication never pulls untested code. */
export async function prepareReleasePublication({
  verifyRemote = false,
  runner = runCommand,
  logger = console,
  ...options
} = {}) {
  const headSha = await assertValidatedRelease({ ...options, runner, logger });
  await runStrict('git', ['diff', '--exit-code', 'HEAD', '--'], {
    runner,
    logger,
  });
  if (verifyRemote) {
    await runStrict('git', ['fetch', 'origin', 'main'], { runner, logger });
    await runStrict(
      'git',
      ['merge-base', '--is-ancestor', headSha, 'origin/main'],
      {
        runner,
        logger,
      }
    );
  }
  return headSha;
}
