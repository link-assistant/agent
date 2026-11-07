import type { Auth } from './index';

/**
 * OAuth callback result types
 */
export type AuthResult =
  | { type: 'failed' }
  | {
      type: 'success';
      provider?: string;
      refresh: string;
      access: string;
      expires: number;
      enterpriseUrl?: string;
    }
  | { type: 'success'; provider?: string; key: string };

/**
 * Auth method prompt configuration
 */
export interface AuthPrompt {
  type: 'text' | 'select';
  key: string;
  message: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
  condition?: (inputs: Record<string, string>) => boolean;
  validate?: (value: string) => string | undefined;
}

/**
 * OAuth authorization result
 */
export interface AuthorizeResult {
  url?: string;
  instructions?: string;
  method: 'code' | 'auto';
  callback: (code?: string) => Promise<AuthResult>;
}

/**
 * Auth method definition
 */
export interface AuthMethod {
  label: string;
  type: 'oauth' | 'api';
  prompts?: AuthPrompt[];
  authorize?: (
    inputs: Record<string, string>
  ) => Promise<AuthorizeResult | AuthResult>;
}

/**
 * Auth plugin definition
 */
export interface AuthPlugin {
  provider: string;
  methods: AuthMethod[];
  loader?: (
    getAuth: () => Promise<Auth.Info | undefined>,
    provider: any
  ) => Promise<{
    apiKey?: string;
    baseURL?: string;
    fetch?: typeof fetch;
    /** Extra SDK options, e.g. GitLab's `instanceUrl`. */
    options?: Record<string, any>;
  }>;
}
