import * as core from '@actions/core';
import * as glob from '@actions/glob';
import { DefaultArtifactClient } from '@actions/artifact';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { downloadArtifactArchive } from './extract.mjs';
import {
  uploadArtifactWithRetry,
  downloadArtifactsWithRetry,
} from '../../../scripts/artifact-transport.mjs';
import {
  collectArtifactFiles,
  packagePages,
} from '../../../scripts/artifact-files.mjs';

async function main() {
  const client = new DefaultArtifactClient();
  const input = core.getInput('path', { required: true });
  if (core.getInput('mode') === 'download') {
    await downloadArtifactsWithRetry(
      {
        listArtifacts: (options) => client.listArtifacts(options),
        downloadArtifact: (id, options) =>
          downloadArtifactArchive(client, id, options),
      },
      core.getInput('pattern', { required: true }),
      path.resolve(input)
    );
    return;
  }
  if (
    core.getInput('mode') !== 'upload' ||
    core.getInput('if-no-files-found') !== 'error'
  ) {
    throw new Error('Invalid artifact mode or evidence policy');
  }
  const pages = core.getInput('pages') === 'true';
  const search = await glob.create(input, {
    implicitDescendants: true,
    followSymbolicLinks: true,
    omitBrokenSymbolicLinks: true,
    excludeHiddenFiles: true,
  });
  const evidence = await collectArtifactFiles(
    search,
    input,
    core.getInput('required-file')
  );
  const retentionDays = Number(core.getInput('retention-days'));
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new Error('Invalid artifact retention');
  }
  let temporary;
  try {
    let upload = evidence;
    if (pages) {
      upload = await packagePages(input);
      temporary = upload.root;
    }
    const result = await uploadArtifactWithRetry(
      client,
      core.getInput('name', { required: true }),
      upload.files,
      upload.root,
      {
        retentionDays: retentionDays || (pages ? 1 : undefined),
        compressionLevel: pages ? 0 : 6,
      }
    );
    core.setOutput('artifact-id', result.id);
  } finally {
    if (temporary) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
main().catch((error) => core.setFailed(error));
