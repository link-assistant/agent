export const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmjs.org';

function getNpmRegistryFromEnv() {
  try {
    // npm itself reads the lowercase `npm_config_registry` form, so honor both.
    return (
      process.env.NPM_CONFIG_REGISTRY || process.env.npm_config_registry || ''
    );
  } catch {
    return '';
  }
}

/**
 * Normalize an npm registry URL so package metadata paths can be appended.
 * @param {string} registryUrl
 * @returns {string}
 */
export function normalizeRegistryUrl(
  registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL
) {
  return String(registryUrl || DEFAULT_NPM_REGISTRY_URL).replace(/\/+$/, '');
}

/**
 * Encode a package name for npm registry metadata URLs.
 * @param {string} packageName
 * @returns {string}
 */
export function encodePackageName(packageName) {
  if (typeof packageName !== 'string' || packageName.trim() === '') {
    throw new Error('Package name is required');
  }

  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/');
    if (!scope || !name) {
      throw new Error(`Invalid scoped package name: ${packageName}`);
    }
    return `${scope}%2F${encodeURIComponent(name)}`;
  }

  return encodeURIComponent(packageName);
}

/**
 * Build the npm registry package metadata URL.
 * @param {string} packageName
 * @param {string} registryUrl
 * @returns {string}
 */
export function buildPackageMetadataUrl(
  packageName,
  registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL
) {
  return `${normalizeRegistryUrl(registryUrl)}/${encodePackageName(packageName)}`;
}

/** Request a fresh, small document for one immutable version. */
export function buildPackageVersionUrl(packageName, version, registryUrl) {
  return `${buildPackageMetadataUrl(packageName, registryUrl)}/${encodeURIComponent(version)}`;
}

/**
 * Check whether a package version exists in npm registry metadata.
 * HTTP 404 means the package has not been published yet and is not an error.
 * @param {string} packageName
 * @param {string} version
 * @param {object} options
 * @param {Function} [options.fetchFn]
 * @param {string} [options.registryUrl]
 * @returns {Promise<boolean>}
 */
export async function isPackageVersionPublished(
  packageName,
  version,
  {
    fetchFn = fetch,
    registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL,
  } = {}
) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('Package version is required');
  }

  const metadataUrl = `${buildPackageVersionUrl(packageName, version, registryUrl)}?cache-bust=${Date.now()}`;
  const response = await fetchFn(metadataUrl, {
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
    },
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch npm package metadata for ${packageName}: ${response.status} ${response.statusText}`
    );
  }

  const metadata = await response.json();
  return metadata?.version === version;
}
