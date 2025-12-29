/**
 * Google Cloud Code API Client
 *
 * This module provides a client for Google's Cloud Code API (cloudcode-pa.googleapis.com),
 * which is used by the official Gemini CLI for OAuth-authenticated requests.
 *
 * The Cloud Code API:
 * 1. Accepts `cloud-platform` OAuth scope (unlike generativelanguage.googleapis.com)
 * 2. Handles subscription tier validation (FREE, STANDARD, etc.)
 * 3. Proxies requests to the Generative Language API internally
 *
 * @see https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts
 * @see https://github.com/link-assistant/agent/issues/100
 */

import { Log } from '../util/log';
import { Auth } from '../auth';

const log = Log.create({ service: 'google-cloudcode' });

// Cloud Code API endpoints (from gemini-cli)
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

// Google OAuth endpoints
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_OAUTH_CLIENT_SECRET = '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';

/**
 * User tier from Cloud Code API
 */
export enum UserTierId {
  FREE = 'FREE',
  STANDARD = 'STANDARD',
  LEGACY = 'LEGACY',
}

/**
 * Cloud Code API request format
 */
interface CloudCodeRequest {
  model: string;
  project?: string;
  user_prompt_id?: string;
  request: {
    contents: Array<{
      role: string;
      parts: Array<{ text?: string; [key: string]: unknown }>;
    }>;
    systemInstruction?: {
      role: string;
      parts: Array<{ text?: string }>;
    };
    tools?: unknown[];
    toolConfig?: unknown;
    generationConfig?: {
      temperature?: number;
      topP?: number;
      topK?: number;
      maxOutputTokens?: number;
      candidateCount?: number;
      stopSequences?: string[];
      responseMimeType?: string;
      responseSchema?: unknown;
      thinkingConfig?: {
        thinkingBudget?: number;
      };
    };
    safetySettings?: unknown[];
  };
}

/**
 * Cloud Code API response format
 */
interface CloudCodeResponse {
  response: {
    candidates: Array<{
      content: {
        role: string;
        parts: Array<{
          text?: string;
          thought?: boolean;
          functionCall?: unknown;
          functionResponse?: unknown;
        }>;
      };
      finishReason?: string;
      safetyRatings?: unknown[];
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
    };
    modelVersion?: string;
  };
  traceId?: string;
}

/**
 * Load Code Assist response (for user setup)
 */
interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string;
  currentTier?: {
    id: UserTierId;
    name: string;
    description: string;
  };
  allowedTiers?: Array<{
    id: UserTierId;
    name: string;
    description: string;
    isDefault?: boolean;
    userDefinedCloudaicompanionProject?: boolean;
  }>;
}

/**
 * Onboard user response (for user setup)
 */
interface OnboardUserResponse {
  done: boolean;
  response?: {
    cloudaicompanionProject?: {
      id: string;
    };
  };
}

/**
 * Google Cloud Code API client
 *
 * This client implements the same API used by the official Gemini CLI.
 * It wraps OAuth authentication and provides methods for:
 * - Setting up user (onboarding to FREE/STANDARD tier)
 * - Generating content (streaming and non-streaming)
 * - Counting tokens
 */
export class CloudCodeClient {
  private accessToken: string;
  private refreshToken: string;
  private tokenExpiry: number;
  private projectId?: string;
  private userTier?: UserTierId;

  constructor(
    private auth: {
      access: string;
      refresh: string;
      expires: number;
    },
    projectId?: string
  ) {
    this.accessToken = auth.access;
    this.refreshToken = auth.refresh;
    this.tokenExpiry = auth.expires;
    this.projectId = projectId;
  }

  /**
   * Refresh the OAuth access token if expired
   */
  private async ensureValidToken(): Promise<void> {
    const FIVE_MIN_MS = 5 * 60 * 1000;
    if (this.tokenExpiry > Date.now() + FIVE_MIN_MS) {
      return; // Token is still valid
    }

    log.info(() => ({
      message: 'refreshing google oauth token for cloud code',
    }));

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const json = await response.json();
    this.accessToken = json.access_token;
    this.tokenExpiry = Date.now() + json.expires_in * 1000;

    // Update stored auth
    await Auth.set('google', {
      type: 'oauth',
      refresh: this.refreshToken,
      access: this.accessToken,
      expires: this.tokenExpiry,
    });
  }

  /**
   * Make an authenticated request to the Cloud Code API
   */
  private async request<T>(
    method: string,
    body: unknown,
    options: { stream?: boolean } = {}
  ): Promise<T | Response> {
    await this.ensureValidToken();

    const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'x-goog-api-client': 'agent/0.6.3',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(() => ({
        message: 'cloud code api error',
        status: response.status,
        error: errorText,
      }));
      throw new Error(
        `Cloud Code API error: ${response.status} - ${errorText}`
      );
    }

    if (options.stream) {
      return response;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Load code assist to check user tier and project
   */
  async loadCodeAssist(): Promise<LoadCodeAssistResponse> {
    const body = {
      cloudaicompanionProject: this.projectId,
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
        duetProject: this.projectId,
      },
    };

    return this.request<LoadCodeAssistResponse>('loadCodeAssist', body);
  }

  /**
   * Onboard user to a tier (FREE or STANDARD)
   */
  async onboardUser(tierId: UserTierId): Promise<OnboardUserResponse> {
    const body = {
      tierId,
      cloudaicompanionProject:
        tierId === UserTierId.FREE ? undefined : this.projectId,
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
        ...(tierId !== UserTierId.FREE && { duetProject: this.projectId }),
      },
    };

    return this.request<OnboardUserResponse>('onboardUser', body);
  }

  /**
   * Setup user - check tier and onboard if necessary
   */
  async setupUser(): Promise<{ projectId?: string; userTier: UserTierId }> {
    const loadRes = await this.loadCodeAssist();

    // If user already has a tier, use it
    if (loadRes.currentTier) {
      this.userTier = loadRes.currentTier.id;
      this.projectId = loadRes.cloudaicompanionProject || this.projectId;
      return {
        projectId: this.projectId,
        userTier: this.userTier,
      };
    }

    // Find the default tier to onboard to
    let targetTier = UserTierId.FREE;
    for (const tier of loadRes.allowedTiers || []) {
      if (tier.isDefault) {
        targetTier = tier.id;
        break;
      }
    }

    log.info(() => ({ message: 'onboarding user', tier: targetTier }));

    // Poll onboardUser until done
    let lroRes = await this.onboardUser(targetTier);
    while (!lroRes.done) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      lroRes = await this.onboardUser(targetTier);
    }

    this.userTier = targetTier;
    if (lroRes.response?.cloudaicompanionProject?.id) {
      this.projectId = lroRes.response.cloudaicompanionProject.id;
    }

    return {
      projectId: this.projectId,
      userTier: this.userTier,
    };
  }

  /**
   * Generate content (non-streaming)
   */
  async generateContent(request: CloudCodeRequest): Promise<CloudCodeResponse> {
    return this.request<CloudCodeResponse>('generateContent', request);
  }

  /**
   * Generate content (streaming)
   */
  async generateContentStream(request: CloudCodeRequest): Promise<Response> {
    return this.request<Response>('streamGenerateContent', request, {
      stream: true,
    }) as Promise<Response>;
  }

  /**
   * Get project ID (may be set during setup)
   */
  getProjectId(): string | undefined {
    return this.projectId;
  }

  /**
   * Get user tier
   */
  getUserTier(): UserTierId | undefined {
    return this.userTier;
  }
}

/**
 * Create a Cloud Code client from stored Google OAuth credentials
 */
export async function createCloudCodeClient(): Promise<CloudCodeClient | null> {
  const auth = await Auth.get('google');
  if (!auth || auth.type !== 'oauth') {
    return null;
  }

  const projectId =
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GOOGLE_CLOUD_PROJECT_ID'];

  return new CloudCodeClient(auth, projectId);
}

/**
 * Check if Cloud Code API is available (user has OAuth credentials)
 */
export async function isCloudCodeAvailable(): Promise<boolean> {
  const auth = await Auth.get('google');
  return auth?.type === 'oauth';
}
