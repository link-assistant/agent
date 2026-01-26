import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Auth } from "../../auth"
import {
  QwenOAuthDeviceFlow,
  openBrowser,
  isHeadlessEnvironment,
  QWEN_PROVIDER_ID,
  QWEN_OAUTH_CONSTANTS,
} from "../../qwen/oauth"

export const AuthCommand = cmd({
  command: "auth",
  describe: "Manage authentication for AI providers",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthStatusCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthLoginCommand = cmd({
  command: "login [provider]",
  describe: "Login to an AI provider",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "Provider to login (qwen, alibaba)",
        type: "string",
      })
      .option("api-key", {
        describe: "Use API key authentication instead of OAuth",
        type: "string",
      })
  },
  async handler(args) {
    const provider = args.provider?.toLowerCase()

    // If no provider specified, show interactive menu
    if (!provider) {
      UI.empty()
      prompts.intro("Login to AI Provider")

      const selectedProvider = await prompts.select({
        message: "Select a provider to login",
        options: [
          {
            label: "Qwen Coder (OAuth - Free Tier)",
            value: "qwen-oauth",
            hint: "2,000 free requests/day via chat.qwen.ai",
          },
          {
            label: "Alibaba DashScope (API Key)",
            value: "alibaba",
            hint: "Pay-as-you-go via DashScope API",
          },
        ],
      })
      if (prompts.isCancel(selectedProvider)) throw new UI.CancelledError()

      if (selectedProvider === "qwen-oauth") {
        await loginQwenOAuth()
      } else if (selectedProvider === "alibaba") {
        await loginApiKey("alibaba", "DASHSCOPE_API_KEY")
      }

      prompts.outro("Login successful!")
      return
    }

    // Handle specific provider
    if (provider === "qwen" || provider === "qwen-coder") {
      if (args.apiKey) {
        await loginApiKeyDirect(QWEN_PROVIDER_ID, args.apiKey)
      } else {
        UI.empty()
        prompts.intro("Qwen Coder Login")
        await loginQwenOAuth()
        prompts.outro("Login successful!")
      }
      return
    }

    if (provider === "alibaba" || provider === "dashscope") {
      if (args.apiKey) {
        await loginApiKeyDirect("alibaba", args.apiKey)
      } else {
        UI.empty()
        prompts.intro("Alibaba DashScope Login")
        await loginApiKey("alibaba", "DASHSCOPE_API_KEY")
        prompts.outro("Login successful!")
      }
      return
    }

    UI.error(`Unknown provider: ${provider}. Supported: qwen, alibaba`)
    process.exit(1)
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout [provider]",
  describe: "Logout from an AI provider",
  builder: (yargs: Argv) => {
    return yargs.positional("provider", {
      describe: "Provider to logout from",
      type: "string",
    })
  },
  async handler(args) {
    const provider = args.provider?.toLowerCase()

    if (!provider) {
      UI.empty()
      prompts.intro("Logout from AI Provider")

      // Get all authenticated providers
      const authData = await Auth.all()
      const providers = Object.keys(authData)

      if (providers.length === 0) {
        prompts.log.info("No providers are currently authenticated")
        prompts.outro("Done")
        return
      }

      const selectedProvider = await prompts.select({
        message: "Select a provider to logout from",
        options: providers.map((p) => ({
          label: p,
          value: p,
        })),
      })
      if (prompts.isCancel(selectedProvider)) throw new UI.CancelledError()

      await Auth.remove(selectedProvider)
      prompts.log.success(`Logged out from ${selectedProvider}`)
      prompts.outro("Done")
      return
    }

    // Normalize provider name
    let providerKey = provider
    if (provider === "qwen" || provider === "qwen-coder") {
      providerKey = QWEN_PROVIDER_ID
    } else if (provider === "dashscope") {
      providerKey = "alibaba"
    }

    const auth = await Auth.get(providerKey)
    if (!auth) {
      UI.info(`Not logged in to ${provider}`)
      return
    }

    await Auth.remove(providerKey)
    UI.success(`Logged out from ${provider}`)
  },
})

export const AuthStatusCommand = cmd({
  command: "status",
  describe: "Show authentication status for all providers",
  async handler() {
    const authData = await Auth.all()
    const providers = Object.entries(authData)

    if (providers.length === 0) {
      UI.info("No providers are currently authenticated")
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + "Run 'agent auth login' to authenticate with a provider")
      return
    }

    UI.println(UI.Style.TEXT_BOLD + "Authenticated Providers:" + UI.Style.TEXT_NORMAL)
    UI.empty()

    for (const [providerID, auth] of providers) {
      const typeLabel =
        auth.type === "oauth"
          ? UI.Style.TEXT_SUCCESS_BOLD + "[OAuth]"
          : UI.Style.TEXT_INFO_BOLD + "[API Key]"

      UI.println(
        UI.Style.TEXT_INFO_BOLD +
          `  ${providerID}` +
          UI.Style.TEXT_NORMAL +
          ` ${typeLabel}` +
          UI.Style.TEXT_NORMAL
      )

      if (auth.type === "oauth") {
        const expiresAt = new Date(auth.expires)
        const isExpired = auth.expires < Date.now()
        const expiryStatus = isExpired
          ? UI.Style.TEXT_DANGER_BOLD + "Expired"
          : UI.Style.TEXT_SUCCESS_BOLD + "Valid"

        UI.println(UI.Style.TEXT_DIM + `    Status: ${expiryStatus}` + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_DIM + `    Expires: ${expiresAt.toLocaleString()}`)
      } else if (auth.type === "api") {
        const maskedKey = auth.key.substring(0, 8) + "..." + auth.key.substring(auth.key.length - 4)
        UI.println(UI.Style.TEXT_DIM + `    Key: ${maskedKey}`)
      }

      UI.empty()
    }
  },
})

/**
 * Login using Qwen OAuth device flow
 */
async function loginQwenOAuth(): Promise<void> {
  const flow = new QwenOAuthDeviceFlow()

  const spinner = prompts.spinner()
  spinner.start("Starting Qwen OAuth authorization...")

  try {
    const authInfo = await flow.startAuthorization()
    spinner.stop("Authorization started")

    const isHeadless = isHeadlessEnvironment()

    // Show user code and URL
    UI.empty()
    if (isHeadless) {
      prompts.log.info(`Visit: ${authInfo.verificationUri}`)
      prompts.log.info(`Enter code: ${UI.Style.TEXT_BOLD}${authInfo.userCode}${UI.Style.TEXT_NORMAL}`)
      UI.empty()
      prompts.log.info(`Or open this URL directly:`)
      prompts.log.info(authInfo.verificationUriComplete)
    } else {
      prompts.log.info("Opening browser for authentication...")
      prompts.log.info(`If browser doesn't open, visit: ${authInfo.verificationUriComplete}`)
      prompts.log.info(`Code: ${UI.Style.TEXT_BOLD}${authInfo.userCode}${UI.Style.TEXT_NORMAL}`)
      openBrowser(authInfo.verificationUriComplete)
    }

    UI.empty()
    spinner.start("Waiting for authorization (this may take a minute)...")

    const credentials = await flow.waitForAuthorization()
    spinner.stop("Authorization successful!")

    // Save credentials
    await Auth.set(QWEN_PROVIDER_ID, {
      type: "oauth",
      refresh: credentials.refreshToken || "",
      access: credentials.accessToken,
      expires: credentials.expiresAt,
    })

    prompts.log.success("Qwen OAuth credentials saved")
    prompts.log.info(`You now have access to Qwen Coder models via OAuth (2,000 free requests/day)`)
  } catch (error) {
    spinner.stop("Authorization failed")
    throw error
  }
}

/**
 * Login using API key (interactive)
 */
async function loginApiKey(providerID: string, envVarName: string): Promise<void> {
  const apiKey = await prompts.text({
    message: `Enter your ${providerID} API key`,
    placeholder: "sk-...",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "API key is required"
      }
      if (!value.startsWith("sk-")) {
        return "Invalid API key format (should start with 'sk-')"
      }
      return undefined
    },
  })
  if (prompts.isCancel(apiKey)) throw new UI.CancelledError()

  await Auth.set(providerID, {
    type: "api",
    key: apiKey.trim(),
  })

  prompts.log.success(`${providerID} API key saved`)
  prompts.log.info(`Alternatively, you can set the ${envVarName} environment variable`)
}

/**
 * Login using API key (non-interactive)
 */
async function loginApiKeyDirect(providerID: string, apiKey: string): Promise<void> {
  if (!apiKey.startsWith("sk-")) {
    UI.error("Invalid API key format (should start with 'sk-')")
    process.exit(1)
  }

  await Auth.set(providerID, {
    type: "api",
    key: apiKey.trim(),
  })

  UI.success(`${providerID} API key saved`)
}
