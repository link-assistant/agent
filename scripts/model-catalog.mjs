/** Strict parsing: a failed/empty catalog must never count as a passing check. */
export function catalogIDs(body, provider) {
  if (
    !Array.isArray(body?.data) ||
    body.data.length === 0 ||
    body.data.some((row) => typeof row?.id !== 'string' || !row.id)
  ) {
    throw new Error(`${provider}: invalid or empty model catalog`);
  }
  return new Set(body.data.map((row) => row.id));
}

export function missingModels(expected, live) {
  return Object.entries(expected)
    .filter(([, model]) => !live.has(model.id))
    .map(([alias, model]) => `${alias} -> ${model.id}`);
}

export async function fetchCatalog(url, provider, fetchFn = fetch) {
  const response = await fetchFn(url, {
    signal: globalThis.AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(
      `${provider}: model catalog returned HTTP ${response.status}`
    );
  }
  return catalogIDs(await response.json(), provider);
}
