/**
 * A dependency-free GitHub REST client for workflow scripts, and the rule
 * that decides whether a failed request is worth repeating.
 */

const NETWORK_CODES =
  /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_\w+)$/;

export class HttpError extends Error {
  constructor(status, statusText, { method, path, requestId, body } = {}) {
    super(`HTTP ${status} ${statusText || ''}`.trim());
    this.name = 'HttpError';
    Object.assign(this, { status, method, path, requestId, body });
  }
}

/**
 * Whether a later attempt can succeed: HTTP 429 and 5xx, request timeouts and
 * network failures. Every other HTTP status is a refusal.
 * @param {unknown} error
 */
export function isTransient(error) {
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  const chain = [];
  for (let item = error; item && !chain.includes(item); item = item.cause) {
    chain.push(item);
  }
  return chain.some(
    (item) =>
      item.name === 'TimeoutError' ||
      NETWORK_CODES.test(String(item.code ?? '')) ||
      (item.name === 'TypeError' && /fetch failed/i.test(item.message))
  );
}

/** One line naming the request, the status and the GitHub request ID. */
export function describe(error) {
  if (!(error instanceof HttpError)) {
    return error?.message || String(error);
  }
  const detail = [`${error.method} ${error.path}: ${error.message}`];
  if (error.requestId) {
    detail.push(`request ID ${error.requestId}`);
  }
  if (error.body) {
    detail.push(String(error.body).slice(0, 300));
  }
  return detail.join('; ');
}

export function githubApi({
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
  timeoutMs = 30000,
}) {
  return async (method, path, body) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'js-ai-driven-development-pipeline-template',
        'x-github-api-version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, {
        method,
        path,
        requestId: response.headers.get('x-github-request-id'),
        body: text,
      });
    }
    return text ? JSON.parse(text) : {};
  };
}
