/** GitHub release operations whose failures must not become successful skips. */

export async function createOrFindRelease({ create, read, tag }) {
  try {
    await create();
    return true;
  } catch (error) {
    // A generic 422 (Validation Failed) can mean an invalid tag or oversized
    // body. Only a successful lookup of this exact public release is evidence
    // that a previous attempt already created it.
    try {
      const release = await read();
      if (
        release.tag_name === tag &&
        Number.isSafeInteger(release.id) &&
        release.id > 0 &&
        release.draft === false
      ) {
        return false;
      }
    } catch {
      // Preserve the create failure when lookup also fails (including 401/403).
    }
    throw error;
  }
}

export async function findReleaseId(read) {
  let release;
  try {
    release = await read();
  } catch (error) {
    const diagnostic = [error.message, error.stderr, error.result?.stderr].join(
      '\n'
    );
    if (/\(HTTP 404\)/.test(diagnostic)) {
      return null;
    }
    throw error;
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new Error('GitHub release response has no valid release ID');
  }
  return String(release.id);
}
