import { setTimeout as delay } from 'node:timers/promises';

export function isTransientArtifactError(error) {
  const chain = [];
  for (let item = error; item && !chain.includes(item); item = item.cause) {
    chain.push(item);
  }
  const statuses = chain
    .map((item) =>
      Number(item.statusCode || item.status || item.response?.status)
    )
    .filter(Boolean);
  const message = chain
    .map((item) => `${item.code || ''} ${item.message || ''}`)
    .join(' ');
  if (
    statuses.some(
      (status) => status >= 400 && status < 500 && status !== 429
    ) ||
    /\b(400|401|403|404|409|410|422)\b|forbidden|unauthori[sz]ed|quota|storage limit|not accessible by integration/i.test(
      message
    )
  ) {
    return false;
  }
  return (
    statuses.some((status) => status === 429 || status >= 500) ||
    /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|EPIPE|socket hang up|\b(429|5\d\d)\b/i.test(
      message
    )
  );
}

export async function retryArtifact(
  operation,
  { sleep = delay, log = console.log } = {}
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === 3 || !isTransientArtifactError(error)) {
        throw error;
      }
      log(
        `Artifact transport failed (${error.message}); retry ${attempt}/2 in ${attempt * 5}s`
      );
      await sleep(attempt * 5000);
    }
  }
}

export function uploadArtifactWithRetry(
  client,
  name,
  files,
  root,
  options = {},
  retryOptions
) {
  if (!files.length) {
    throw new Error('Required artifact evidence is empty');
  }
  return retryArtifact(async (attempt) => {
    if (attempt > 1) {
      // Names are unique per job/run. A lost finalize response may have left
      // this attempt's artifact behind; delete it before sending the same files.
      try {
        await client.deleteArtifact(name);
      } catch (error) {
        if (error.name !== 'ArtifactNotFoundError') {
          throw error;
        }
      }
    }
    const result = await client.uploadArtifact(name, files, root, options);
    if (!Number.isSafeInteger(result.id) || result.id <= 0) {
      throw new Error('Artifact upload returned no valid artifact ID');
    }
    return result;
  }, retryOptions);
}

export async function downloadArtifactsWithRetry(
  client,
  pattern,
  directory,
  retryOptions
) {
  if (!/^[\w.-]+\*?$/.test(pattern)) {
    throw new Error('Artifact pattern must be a name or prefix followed by *');
  }
  const { artifacts } = await retryArtifact(
    () => client.listArtifacts({ latest: true }),
    retryOptions
  );
  const selected = artifacts.filter((artifact) =>
    pattern.endsWith('*')
      ? artifact.name.startsWith(pattern.slice(0, -1))
      : artifact.name === pattern
  );
  if (!selected.length) {
    throw new Error(`Required artifacts not found: ${pattern}`);
  }
  for (const artifact of selected) {
    await retryArtifact(
      () =>
        client.downloadArtifact(artifact.id, {
          path: directory,
          // The SDK verifies the downloaded archive only when given the
          // digest recorded at upload time.
          ...(artifact.digest ? { expectedHash: artifact.digest } : {}),
        }),
      retryOptions
    );
  }
  return directory;
}
