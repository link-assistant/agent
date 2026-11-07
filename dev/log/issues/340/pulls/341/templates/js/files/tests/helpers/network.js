/** Explain why a network integration cannot run without disguising a permission denial. */
export async function networkSkipReason({
  url,
  runtime = globalThis.Deno,
  fetchFn = fetch,
}) {
  if (typeof runtime?.permissions?.query === 'function') {
    const host = new globalThis.URL(url).host;
    const { state } = await runtime.permissions.query({ name: 'net', host });
    if (state !== 'granted') {
      return `Deno net permission for ${host} is ${state}`;
    }
  }
  try {
    const response = await fetchFn(url, {
      method: 'HEAD',
      signal: globalThis.AbortSignal.timeout(5000),
    });
    return response.ok ? null : `${url} answered HTTP ${response.status}`;
  } catch (error) {
    return `${url} is unreachable (${error?.cause?.message ?? error?.message ?? error})`;
  }
}
