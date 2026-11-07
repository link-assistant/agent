/** GitHub release operations whose failures must not become successful skips. */

// Compare heading text directly: SemVer build metadata contains regex operators
// such as '+', and a prefix match can confuse 1.0.1 with 1.0.10.
export function extractReleaseNotes(changelog, version) {
  let collecting = false;
  const notes = [];
  for (const line of changelog.split(/\r?\n/)) {
    if (/^##(?:[ \t]|$)/.test(line)) {
      if (collecting) {
        break;
      }
      const heading = line.match(
        /^##[ \t]+(?:\[([^\]]+)\]|(\S+))(?:[ \t].*)?$/
      );
      collecting = Boolean(heading && (heading[1] ?? heading[2]) === version);
    } else if (collecting) {
      notes.push(line);
    }
  }
  return collecting ? notes.join('\n').trim() : null;
}

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
