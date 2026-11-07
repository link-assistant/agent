import { log } from './plugin-utils';

/** Transform only Google's HTTPS API origin into a Cloud Code endpoint. */
export function transformToCloudCodeUrl(
  url: string,
  endpoint = 'https://cloudcode-pa.googleapis.com',
  apiVersion = 'v1internal'
): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'generativelanguage.googleapis.com'
    ) {
      log.debug(() => ({
        message:
          'url is not generativelanguage api, skipping cloud code transform',
        hostname: parsed.hostname,
      }));
      return null;
    }

    const pathMatch = parsed.pathname.match(/:(\w+)$/);
    if (!pathMatch) {
      log.debug(() => ({
        message: 'could not extract method from url path',
        pathname: parsed.pathname,
      }));
      return null;
    }

    const method = pathMatch[1];
    const cloudCodeUrl = `${endpoint}/${apiVersion}:${method}`;

    log.debug(() => ({
      message: 'transformed url to cloud code api',
      originalUrl: url.substring(0, 100),
      method,
      cloudCodeUrl,
    }));

    return cloudCodeUrl;
  } catch (error) {
    log.debug(() => ({
      message: 'failed to parse url for cloud code transform',
      url: url.substring(0, 100),
      error: String(error),
    }));
    return null;
  }
}
