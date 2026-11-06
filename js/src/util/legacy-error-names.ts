import { config } from '../config/config';

/**
 * Backward compatibility for the error objects written to JSON output
 * (issue #335).
 *
 * The upstream sync introduced `ContextOverflowError` for requests that exceed
 * the model's context window. Before, the same failure was reported as a
 * non-retryable `APIError`. Consumers that switch on `error.name` can ask for
 * the previous name with --legacy-error-names /
 * LINK_ASSISTANT_AGENT_LEGACY_ERROR_NAMES=true. Stored session messages keep
 * the new name; only the JSON output is mapped.
 */
const LEGACY_NAMES: Record<
  string,
  (data: Record<string, unknown>) => { name: string; data: unknown }
> = {
  ContextOverflowError: (data) => ({
    name: 'APIError',
    data: { ...data, isRetryable: false },
  }),
};

export function legacyErrorObject<T>(
  error: T,
  enabled: boolean = config.legacyErrorNames
): T {
  if (!enabled || !error || typeof error !== 'object') return error;
  const { name, data } = error as { name?: unknown; data?: unknown };
  if (typeof name !== 'string') return error;
  const map = LEGACY_NAMES[name];
  if (!map) return error;
  return {
    ...error,
    ...map(
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    ),
  } as T;
}
