/**
 * Qwen OAuth 2.0 Device Flow Implementation
 * Compatible with chat.qwen.ai OAuth endpoints
 * Based on RFC 8628 - OAuth 2.0 Device Authorization Grant
 */

import { randomBytes, createHash } from "node:crypto"
import { exec } from "node:child_process"

// Qwen OAuth Endpoints (from qwen-code)
const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai"
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`

// Qwen OAuth Configuration
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"
const QWEN_OAUTH_SCOPE = "openid profile email model.completion"
const QWEN_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

/**
 * PKCE (Proof Key for Code Exchange) utilities
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

export function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash("sha256")
  hash.update(codeVerifier)
  return hash.digest("base64url")
}

export function generatePKCEPair(): {
  codeVerifier: string
  codeChallenge: string
} {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  return { codeVerifier, codeChallenge }
}

/**
 * Device authorization response
 */
export interface DeviceAuthorizationResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval?: number
}

/**
 * Token response
 */
export interface QwenTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
  resource_url?: string
}

/**
 * Qwen credentials stored in memory/storage
 */
export interface QwenCredentials {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt: number
  resourceUrl?: string
}

/**
 * Error response from Qwen OAuth
 */
interface ErrorResponse {
  error: string
  error_description?: string
}

function isErrorResponse(response: unknown): response is ErrorResponse {
  return typeof response === "object" && response !== null && "error" in response
}

/**
 * Poll for device token
 */
export async function pollDeviceToken(
  deviceCode: string,
  codeVerifier: string
): Promise<QwenTokenResponse | "pending" | "slow_down"> {
  const body = new URLSearchParams({
    grant_type: QWEN_OAUTH_GRANT_TYPE,
    client_id: QWEN_OAUTH_CLIENT_ID,
    device_code: deviceCode,
    code_verifier: codeVerifier,
  })

  const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorData = await response.text()

    try {
      const parsed = JSON.parse(errorData)
      if (parsed.error === "authorization_pending") {
        return "pending"
      }
      if (parsed.error === "slow_down") {
        return "slow_down"
      }
      throw new Error(`Token poll failed: ${parsed.error} - ${parsed.error_description || errorData}`)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Token poll failed")) {
        throw e
      }
      throw new Error(`Token poll failed: ${response.status} - ${errorData}`)
    }
  }

  return response.json() as Promise<QwenTokenResponse>
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<QwenTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: QWEN_OAUTH_CLIENT_ID,
  })

  const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Token refresh failed: ${response.status} - ${errorData}`)
  }

  return response.json() as Promise<QwenTokenResponse>
}

/**
 * Open URL in default browser
 */
export function openBrowser(url: string): void {
  const platform = process.platform

  if (platform === "darwin") {
    exec(`open "${url}"`)
  } else if (platform === "win32") {
    exec(`start "" "${url}"`)
  } else {
    // Linux and others
    exec(`xdg-open "${url}"`)
  }
}

/**
 * Check if running in a headless environment (SSH, CI, etc.)
 */
export function isHeadlessEnvironment(): boolean {
  return !!(
    process.env.SSH_CONNECTION ||
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY ||
    process.env.AGENT_HEADLESS ||
    process.env.CI
  )
}

/**
 * Qwen OAuth Device Flow Manager
 * Handles the complete device authorization flow
 */
export class QwenOAuthDeviceFlow {
  private deviceCode: string | null = null
  private codeVerifier: string | null = null
  private pollInterval: number = 2000
  private maxPollAttempts: number = 150 // 5 minutes at 2s intervals
  private cancelled: boolean = false

  /**
   * Start the device authorization flow
   * Returns the authorization info for the user
   */
  async startAuthorization(): Promise<{
    verificationUri: string
    verificationUriComplete: string
    userCode: string
    expiresIn: number
  }> {
    this.cancelled = false

    const { codeVerifier, codeChallenge } = generatePKCEPair()
    this.codeVerifier = codeVerifier

    const body = new URLSearchParams({
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: QWEN_OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })

    const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Device authorization failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json() as DeviceAuthorizationResponse

    this.deviceCode = result.device_code
    if (result.interval) {
      this.pollInterval = result.interval * 1000
    }
    this.maxPollAttempts = Math.ceil(result.expires_in / (this.pollInterval / 1000))

    return {
      verificationUri: result.verification_uri,
      verificationUriComplete: result.verification_uri_complete,
      userCode: result.user_code,
      expiresIn: result.expires_in,
    }
  }

  /**
   * Poll for tokens after user authorizes
   */
  async waitForAuthorization(): Promise<QwenCredentials> {
    if (!this.deviceCode || !this.codeVerifier) {
      throw new Error("Authorization not started. Call startAuthorization() first.")
    }

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      if (this.cancelled) {
        throw new Error("Authorization cancelled")
      }

      const result = await pollDeviceToken(this.deviceCode, this.codeVerifier)

      if (result === "pending") {
        await this.sleep(this.pollInterval)
        continue
      }

      if (result === "slow_down") {
        this.pollInterval = Math.min(this.pollInterval * 1.5, 10000)
        await this.sleep(this.pollInterval)
        continue
      }

      // Success - got tokens
      return {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        tokenType: result.token_type,
        expiresAt: Date.now() + result.expires_in * 1000,
        resourceUrl: result.resource_url,
      }
    }

    throw new Error("Authorization timeout - user did not complete authorization in time")
  }

  /**
   * Cancel the authorization flow
   */
  cancel(): void {
    this.cancelled = true
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Export constants for use in other modules
 */
export const QWEN_OAUTH_CONSTANTS = {
  BASE_URL: QWEN_OAUTH_BASE_URL,
  DEVICE_CODE_ENDPOINT: QWEN_OAUTH_DEVICE_CODE_ENDPOINT,
  TOKEN_ENDPOINT: QWEN_OAUTH_TOKEN_ENDPOINT,
  CLIENT_ID: QWEN_OAUTH_CLIENT_ID,
  SCOPE: QWEN_OAUTH_SCOPE,
  GRANT_TYPE: QWEN_OAUTH_GRANT_TYPE,
  /** Qwen OAuth API endpoint for OAuth-authenticated requests */
  API_URL: "https://portal.qwen.ai/v1",
} as const

/**
 * Qwen provider ID used in auth storage
 */
export const QWEN_PROVIDER_ID = "qwen-coder" as const
