/** Zen uses this typed error for a permanent client restriction. */
export function isFreeTierError(
  status: number | undefined,
  body: unknown
): boolean {
  if (status !== 403) return false;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    return parsed?.error?.type === 'FreeTierError';
  } catch {
    return false;
  }
}

export const FREE_TIER_ERROR_MESSAGE =
  "OpenCode Zen's free tier is limited to OpenCode clients. Use kilo/nemotron-3-super-free (authenticate with agent auth login or KILO_API_KEY), or select a paid model.";
