// Runner runtime credentials are available only inside this JavaScript action.
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findFiles, packagePages } from './files.mjs';
import { withRetry, uploadWithRetry, downloadWithRetry } from './transport.mjs';

async function main() {
  const client = new DefaultArtifactClient();
  const mode = core.getInput('operation') || 'upload';
  const destination = core.getInput('path', { required: true });
  const name = core.getInput('name');
  if (mode === 'upload') {
    if (!name) throw new Error('Artifact name is required');
    const pages = core.getBooleanInput('pages');
    const archive = pages ? await packagePages(destination) : null;
    try {
      const evidence = archive ? { files: [archive.file], root: archive.root } : await findFiles(destination);
      const result = await uploadWithRetry(client, name, evidence.files, evidence.root, {
        retentionDays: Number(core.getInput('retention-days')) || (pages ? 1 : undefined),
        compressionLevel: pages ? 0 : 6,
      });
      core.setOutput('artifact-id', result.id);
      core.setOutput('artifact-digest', result.digest);
      core.setOutput('artifact-url', `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts/${result.id}`);
    } finally { await archive?.cleanup(); }
  } else if (mode === 'download') {
    const pattern = core.getInput('pattern');
    const merge = core.getBooleanInput('merge-multiple');
    const artifacts = name
      ? [(await withRetry(() => client.getArtifact(name))).artifact]
      : (await withRetry(() => client.listArtifacts({ latest: true }))).artifacts.filter(a => {
        const expression = (pattern || '*').split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp(`^${expression}$`).test(a.name);
      });
    if (!artifacts.length) throw new Error('No matching artifacts found');
    for (const artifact of artifacts) {
      if (path.basename(artifact.name) !== artifact.name || ['.', '..'].includes(artifact.name)) throw new Error('Unsafe artifact name');
      await downloadWithRetry(client, artifact, name || merge ? destination : path.join(destination, artifact.name), {
        // Resolve relative to the bundled entry point, not an ncc module URL.
        extract: (archive, target) => execFileSync('python3', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'extract.py'), archive, target], { stdio: 'inherit' }),
      });
    }
    core.setOutput('download-path', path.resolve(destination));
  } else throw new Error(`Unknown artifact operation: ${mode}`);
}

main().catch(error => core.setFailed(error.message));
