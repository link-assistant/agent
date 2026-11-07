// Keep retries at the transport boundary; never repeat the producer/test job.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function isTransient(error) {
  const chain = [];
  for (let item = error; item && !chain.includes(item); item = item.cause) chain.push(item);
  const statuses = chain.map(e => Number(e.statusCode || e.status || e.response?.status)).filter(Boolean);
  const message = chain.map(e => `${e.code || ''} ${e.message || ''}`).join(' ');
  if (statuses.some(n => n >= 400 && n < 500 && n !== 429) ||
      /\b(400|401|403|404|409|422)\b|forbidden|unauthorized|quota|insufficient usage|not accessible by integration/i.test(message)) return false;
  return statuses.some(n => n === 429 || (n >= 500 && n <= 599)) ||
    /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|EPIPE|429|5\d\d)\b|socket hang up/i.test(message);
}

export async function withRetry(operation, { sleep = delay, log = console.log } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isTransient(error) || attempt === 3) throw error;
      log(`Transient artifact transport failure; retry ${attempt + 1}/3 in ${attempt * 5}s: ${error.message}`);
      await sleep(attempt * 5000);
    }
  }
}

export async function uploadWithRetry(client, name, files, root, options, retryOptions) {
  if (!files.length) throw new Error('No files were found to upload');
  // Refuse a stale/other producer's artifact rather than silently accepting it.
  const existing = await withRetry(async () => {
    try { return await client.getArtifact(name); }
    catch (error) { if (error.name !== 'ArtifactNotFoundError') throw error; }
  }, retryOptions);
  if (existing) throw new Error(`Artifact ${name} already exists; names must be unique per producer`);
  return withRetry(async attempt => {
    if (attempt > 1) {
      // A lost finalize response can leave a completed artifact. Only replace
      // our unique name after confirming it was absent before the first upload.
      try { await client.deleteArtifact(name); }
      catch (error) { if (error.name !== 'ArtifactNotFoundError') throw error; }
    }
    const result = await client.uploadArtifact(name, files, root, options);
    if (!result.id) throw new Error(`Upload returned no artifact ID for ${name}`);
    return result;
  }, retryOptions);
}

export async function downloadWithRetry(client, artifact, destination, options = {}) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(artifact.digest || '')) throw new Error(`Missing/invalid artifact digest for ${artifact.name}`);
  const extract = options.extract || ((archive, target) => {
    execFileSync('python3', [fileURLToPath(new URL('./extract.py', import.meta.url)), archive, target], { stdio: 'inherit' });
  });
  return withRetry(async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'artifact-download-'));
    try {
      // Bypass unzip-stream's deprecated Buffer constructors. The SDK still
      // computes and checks the uploaded digest; a mismatch is a hard failure.
      const result = await client.downloadArtifact(artifact.id, {
        path: temporary, skipDecompress: true, expectedHash: artifact.digest,
      });
      if (result.digestMismatch !== false) throw new Error(`Artifact digest verification failed for ${artifact.name}`);
      const files = await readdir(temporary);
      if (files.length !== 1) throw new Error('Expected exactly one downloaded artifact archive');
      await extract(path.join(temporary, files[0]), destination);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, options);
}
