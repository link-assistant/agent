/** Only a definitive 404 means a release is missing; other errors are unknown. */
export async function githubReleaseExists(
  tag,
  {
    repository = process.env.GITHUB_REPOSITORY,
    apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
    token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    fetchFn = fetch,
    logger = console,
  } = {}
) {
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
      throw new Error('GITHUB_REPOSITORY is unavailable');
    }
    const response = await fetchFn(
      `${apiUrl.replace(/\/$/, '')}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      }
    );
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`GitHub answered HTTP ${response.status}`);
    }
    const release = await response.json();
    validateRelease(release, tag);
    return true;
  } catch (error) {
    logger.warn(`GitHub release state unknown for ${tag}: ${error.message}`);
    return null;
  }
}
function validateRelease(release, tag) {
  if (
    !Number.isInteger(release.id) ||
    release.id <= 0 ||
    release.tag_name !== tag
  ) {
    throw new Error('Malformed GitHub release response');
  }
}
