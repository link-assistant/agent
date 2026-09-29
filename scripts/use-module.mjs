/**
 * Shared `use-m` loader with CommonJS-namespace normalization.
 *
 * Why this file exists
 * --------------------
 * Every release script loads its dependencies through `use-m`, which resolves a
 * package with `createRequire(...).resolve` and then loads the resolved file
 * with dynamic `import()`. Because the `require` export condition wins during
 * resolution, a dual package such as `command-stream@>=0.19.0` is loaded
 * through its CommonJS entry point.
 *
 * Node.js 23.0.0+ adds a synthetic `'module.exports'` named export to CommonJS
 * namespaces (https://nodejs.org/api/esm.html#commonjs-namespaces). `use-m`
 * 8.15.0 unwraps a callable `default` only when every other key is known
 * metadata, and `'module.exports'` is not in that set, so on Node 24 it returns
 * `{ default, 'module.exports' }` instead of the callable module. Destructuring
 * `const { $ } = await use('command-stream')` then yields `undefined`, and the
 * first tagged-template call fails with `TypeError: $ is not a function`.
 *
 * Upstream report: https://github.com/link-foundation/use-m/issues/72
 *
 * `useModule()` below returns a namespace with the named exports hoisted back to
 * the top level on every Node.js version, so callers can keep destructuring.
 *
 * Debug tracing is off by default. Set `CI_SCRIPTS_DEBUG=1` (or `=true`) to
 * print the resolved module shape, which is what makes an interop regression
 * like the one above diagnosable from a CI log alone.
 */

const USE_M_URL = 'https://unpkg.com/use-m/use.js';

/**
 * Keys Node.js and bundlers attach to a namespace that carry no user-facing
 * exports. `'module.exports'` is the Node 23+ CommonJS interop marker.
 */
const METADATA_KEYS = new Set(['default', 'module.exports', '__esModule']);

export const isDebugEnabled = () =>
  ['1', 'true', 'yes'].includes(
    String(process.env.CI_SCRIPTS_DEBUG ?? '').toLowerCase()
  );

export const debug = (...args) => {
  if (isDebugEnabled()) {
    console.log('[use-module]', ...args);
  }
};

const describe = (value) => {
  if (value === null || value === undefined) {
    return String(value);
  }
  const type = typeof value;
  if (type !== 'object' && type !== 'function') {
    return type;
  }
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    keys = ['<unreadable>'];
  }
  return `${type}(${keys.join(', ')})`;
};

/**
 * Collapse a CommonJS namespace back into the object the package actually
 * exports, then re-expose its own enumerable properties at the top level.
 *
 * The returned object always keeps `default` pointing at the callable/plain
 * CommonJS export, so `mod.default` stays valid for callers that use it.
 */
export const normalizeModule = (loaded) => {
  if (loaded === null || loaded === undefined) {
    return loaded;
  }

  const cjsDefault = loaded['module.exports'] ?? loaded.default;
  const hasNamedExports = Object.keys(loaded).some(
    (key) => !METADATA_KEYS.has(key)
  );

  // A real ES module namespace already exposes its named exports.
  if (hasNamedExports || cjsDefault === undefined) {
    return loaded;
  }

  const type = typeof cjsDefault;
  if (type !== 'object' && type !== 'function') {
    return loaded;
  }

  const normalized = { default: cjsDefault };
  for (const key of Object.keys(cjsDefault)) {
    normalized[key] = cjsDefault[key];
  }
  debug('normalized CommonJS namespace ->', describe(normalized));
  return normalized;
};

let usePromise;

/** Fetch and evaluate `use-m` once per process. */
export const loadUse = async () => {
  usePromise ??= (async () => {
    debug('loading use-m from', USE_M_URL);
    const response = await fetch(USE_M_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch use-m from ${USE_M_URL}: ${response.status} ${response.statusText}`
      );
    }
    const { use } = await eval(await response.text());
    if (typeof use !== 'function') {
      throw new Error(
        `use-m did not export a callable "use" (got ${typeof use}) from ${USE_M_URL}`
      );
    }
    return use;
  })();
  return await usePromise;
};

/**
 * Load a package through `use-m` and return a namespace whose named exports are
 * reachable at the top level on every supported Node.js version.
 */
export const useModule = async (specifier) => {
  const use = await loadUse();
  const loaded = await use(specifier);
  debug(`use(${specifier}) on ${process.version} ->`, describe(loaded));
  return normalizeModule(loaded);
};

export default useModule;
