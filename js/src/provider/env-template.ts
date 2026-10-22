import type { ModelsDev } from './models';

/**
 * Environment handling for models.dev provider entries.
 *
 * models.dev (the catalogue OpenCode uses) describes some providers with
 * templated base URLs such as
 * `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1`
 * and lists the template variables next to the real credentials in
 * `provider.env`. The variables configure *where* to send requests; only the
 * remaining variables carry a credential.
 *
 * @see https://github.com/link-assistant/agent/issues/334
 */
export namespace EnvTemplate {
  const PATTERN = /\$\{([A-Za-z0-9_]+)\}/g;

  /**
   * Variable names that configure an endpoint, account, region or project.
   * They must never be sent as an API key.
   */
  const NON_CREDENTIAL =
    /(_ID|_NAME|_REGION|_PROJECT|_LOCATION|_HOST|_URL|_ACCOUNT|_ENDPOINT|_CREDENTIALS|_RESOURCE_GROUP|_VERSION|_ORG|_ORGANIZATION)$/;

  /** Part of a SigV4 key pair, not a bearer credential. */
  const PAIRED_SECRETS = new Set(['AWS_SECRET_ACCESS_KEY']);

  export function variables(template?: string): string[] {
    if (!template) return [];
    return Array.from(template.matchAll(PATTERN), (match) => match[1]);
  }

  export function isCredentialEnv(name: string): boolean {
    return !NON_CREDENTIAL.test(name) && !PAIRED_SECRETS.has(name);
  }

  /**
   * The env vars of a provider that hold an API key, in catalogue order.
   */
  export function credentialEnv(provider: ModelsDev.Provider): string[] {
    const templated = new Set(variables(provider.api));
    for (const model of Object.values(provider.models ?? {})) {
      for (const name of variables(model.provider?.api)) templated.add(name);
    }
    return (provider.env ?? []).filter(
      (name) => !templated.has(name) && isCredentialEnv(name)
    );
  }

  /**
   * Values for template variables that OpenCode derives instead of reading
   * verbatim (normalized hosts, Vertex endpoint, default AWS region).
   */
  export function derived(
    env: Record<string, string | undefined> = process.env
  ): Record<string, string | undefined> {
    const location =
      env['GOOGLE_VERTEX_LOCATION'] ??
      env['GOOGLE_CLOUD_LOCATION'] ??
      env['VERTEX_LOCATION'] ??
      'global';
    return {
      AWS_REGION: env['AWS_REGION'] ?? env['AWS_DEFAULT_REGION'] ?? 'us-east-1',
      DATABRICKS_HOST: stripHost(env['DATABRICKS_HOST']),
      SNOWFLAKE_ACCOUNT: stripHost(env['SNOWFLAKE_ACCOUNT'])?.replace(
        /\.snowflakecomputing\.com$/,
        ''
      ),
      NEON_AI_GATEWAY_BASE_URL: env['NEON_AI_GATEWAY_BASE_URL']?.replace(
        /\/+$/,
        ''
      ),
      GOOGLE_VERTEX_PROJECT:
        env['GOOGLE_VERTEX_PROJECT'] ??
        env['GOOGLE_CLOUD_PROJECT'] ??
        env['GCP_PROJECT'] ??
        env['GCLOUD_PROJECT'],
      GOOGLE_VERTEX_LOCATION: location,
      GOOGLE_VERTEX_ENDPOINT:
        location === 'global'
          ? 'aiplatform.googleapis.com'
          : `${location}-aiplatform.googleapis.com`,
    };
  }

  function stripHost(value?: string) {
    if (!value) return undefined;
    return value.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  }

  /**
   * Substitute `${VAR}` placeholders. Returns `undefined` when any variable is
   * missing, so callers never send requests to a half-filled URL.
   */
  export function resolve(
    template: string | undefined,
    env: Record<string, string | undefined> = process.env,
    values: Record<string, string | undefined> = {}
  ): string | undefined {
    if (!template) return undefined;
    if (!template.includes('${')) return template;
    const lookup = { ...derived(env), ...values };
    let missing = false;
    const result = template.replace(PATTERN, (_, name: string) => {
      const value = lookup[name] ?? env[name];
      if (!value) missing = true;
      return value ?? '';
    });
    return missing ? undefined : result;
  }

  export function isTemplate(value?: string): boolean {
    return Boolean(value?.includes('${'));
  }
}
