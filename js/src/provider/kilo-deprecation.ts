import { Log } from '../util/log';
import { Kilo } from './kilo';

const log = Log.create({ service: 'kilo' });

// Aliases already warned about. A stored session or config that names an
// alias reaches getModel()/parseModel() many times in one process, so warn
// once per alias; the set is bounded by `Kilo.DEPRECATED_ALIASES`.
const warned = new Set<string>();

/**
 * Map a deprecated Kilo alias (`Kilo.DEPRECATED_ALIASES`) to its replacement
 * and warn about it (once per alias and process); any other model ID is
 * returned unchanged (#335).
 *
 * Kept out of `kilo.ts` so that module has no runtime dependencies.
 */
export function resolveKiloDeprecatedAlias(modelID: string): string {
  const replacement = Kilo.deprecatedAliasTarget(modelID);
  if (!replacement) return modelID;
  if (warned.has(modelID)) return replacement;
  warned.add(modelID);
  log.warn(() => ({
    message: `kilo/${modelID} is deprecated and no longer served by Kilo; using kilo/${replacement} instead`,
    deprecatedModel: `kilo/${modelID}`,
    replacement: `kilo/${replacement}`,
    hint: `Pass --model kilo/${replacement} to silence this warning`,
  }));
  return replacement;
}
