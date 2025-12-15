import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { ClaudeOAuth } from "../../auth/claude-oauth"
import * as prompts from "@clack/prompts"

/**
 * Auth Command
 *
 * Handles authentication for various providers.
 * Currently supports Claude OAuth authentication.
 */

const ClaudeLoginCommand = cmd({
  command: "claude",
  describe: "authenticate with Claude using OAuth (requires Claude Pro/Max subscription)",
  builder: (yargs: Argv) => {
    return yargs
      .option("code", {
        type: "string",
        describe: "authorization code from OAuth callback (for completing authentication)",
      })
      .option("show-url", {
        type: "boolean",
        describe: "only show the authorization URL without opening browser",
        default: false,
      })
  },
  handler: async (args) => {
    UI.empty()

    // If code is provided, complete the authentication
    if (args.code) {
      prompts.intro("Completing Claude OAuth authentication")

      const spinner = prompts.spinner()
      spinner.start("Exchanging authorization code for tokens...")

      const success = await ClaudeOAuth.completeAuth(args.code)

      if (success) {
        spinner.stop("Authentication successful!")
        prompts.outro("You can now use claude-oauth provider with: agent --model claude-oauth/claude-sonnet-4-5")
      } else {
        spinner.stop("Authentication failed", 1)
        prompts.outro("Please try again with: agent auth claude")
        process.exit(1)
      }
      return
    }

    // Start new authentication flow
    prompts.intro("Claude OAuth Authentication")

    prompts.log.info(
      "This will authenticate you with Claude using OAuth.\nYou need a Claude Pro or Max subscription for this to work.\n",
    )

    // Check if already authenticated
    if (await ClaudeOAuth.isAuthenticated()) {
      const creds = await ClaudeOAuth.getCredentials()
      prompts.log.info(
        `You are already authenticated (subscription: ${creds?.subscriptionType ?? "unknown"}).\n` +
          `Token expires: ${creds?.expiresAt ? new Date(creds.expiresAt).toLocaleString() : "unknown"}`,
      )

      const reauth = await prompts.confirm({
        message: "Do you want to re-authenticate?",
        initialValue: false,
      })

      if (prompts.isCancel(reauth) || !reauth) {
        prompts.outro("Keeping existing authentication")
        return
      }
    }

    // Generate authorization URL
    const { url, state } = ClaudeOAuth.generateAuthUrl()

    // Save state for later code exchange
    await ClaudeOAuth.saveState(state)

    prompts.log.step("Authorization URL generated")

    if (args["show-url"]) {
      // Just show the URL
      UI.println()
      UI.println("Open this URL in your browser to authenticate:")
      UI.println()
      UI.println(UI.Style.TEXT_HIGHLIGHT + url + UI.Style.TEXT_NORMAL)
      UI.println()
    } else {
      // Try to open browser
      UI.println()
      UI.println("Opening browser for authentication...")
      UI.println()

      const openUrl = async (url: string) => {
        const { exec } = await import("child_process")
        const { promisify } = await import("util")
        const execAsync = promisify(exec)

        const platform = process.platform
        let command: string

        if (platform === "darwin") {
          command = `open "${url}"`
        } else if (platform === "win32") {
          command = `start "" "${url}"`
        } else {
          // Linux and others
          command = `xdg-open "${url}" || sensible-browser "${url}" || x-www-browser "${url}"`
        }

        try {
          await execAsync(command)
          return true
        } catch {
          return false
        }
      }

      const opened = await openUrl(url)

      if (!opened) {
        UI.println("Could not open browser automatically.")
        UI.println()
        UI.println("Please open this URL manually:")
        UI.println()
        UI.println(UI.Style.TEXT_HIGHLIGHT + url + UI.Style.TEXT_NORMAL)
        UI.println()
      }
    }

    UI.println(UI.Style.TEXT_DIM + "After authenticating, you will be redirected to a page showing your authorization code." + UI.Style.TEXT_NORMAL)
    UI.println()

    // Prompt for authorization code
    const code = await prompts.text({
      message: "Enter the authorization code from the callback page:",
      placeholder: "Paste the code here...",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Authorization code is required"
        }
        return undefined
      },
    })

    if (prompts.isCancel(code)) {
      prompts.cancel("Authentication cancelled")
      await ClaudeOAuth.clearState()
      process.exit(1)
    }

    // Complete authentication
    const spinner = prompts.spinner()
    spinner.start("Exchanging authorization code for tokens...")

    const success = await ClaudeOAuth.completeAuth(code)

    if (success) {
      spinner.stop("Authentication successful!")
      prompts.outro("You can now use claude-oauth provider with: agent --model claude-oauth/claude-sonnet-4-5")
    } else {
      spinner.stop("Authentication failed", 1)
      prompts.outro("Please try again")
      process.exit(1)
    }
  },
})

const ClaudeStatusCommand = cmd({
  command: "claude-status",
  describe: "check Claude OAuth authentication status",
  async handler() {
    UI.empty()
    prompts.intro("Claude OAuth Status")

    const isAuth = await ClaudeOAuth.isAuthenticated()

    if (!isAuth) {
      prompts.log.warning("Not authenticated with Claude OAuth")
      prompts.outro("Run 'agent auth claude' to authenticate")
      return
    }

    const creds = await ClaudeOAuth.getCredentials()

    if (creds) {
      prompts.log.success("Authenticated with Claude OAuth")
      prompts.log.info(`Subscription: ${creds.subscriptionType ?? "unknown"}`)
      prompts.log.info(`Scopes: ${creds.scopes?.join(", ") ?? "unknown"}`)
      prompts.log.info(`Expires: ${creds.expiresAt ? new Date(creds.expiresAt).toLocaleString() : "unknown"}`)

      const isExpired = creds.expiresAt < Date.now()
      if (isExpired) {
        prompts.log.warning("Token is expired - run 'agent auth claude' to re-authenticate")
      }
    }

    prompts.outro("Done")
  },
})

const ClaudeRefreshCommand = cmd({
  command: "claude-refresh",
  describe: "refresh Claude OAuth token",
  async handler() {
    UI.empty()
    prompts.intro("Refreshing Claude OAuth Token")

    const spinner = prompts.spinner()
    spinner.start("Refreshing token...")

    const success = await ClaudeOAuth.refreshToken()

    if (success) {
      spinner.stop("Token refreshed successfully!")
      const creds = await ClaudeOAuth.getCredentials()
      if (creds?.expiresAt) {
        prompts.log.info(`New expiration: ${new Date(creds.expiresAt).toLocaleString()}`)
      }
      prompts.outro("Done")
    } else {
      spinner.stop("Failed to refresh token", 1)
      prompts.outro("Run 'agent auth claude' to re-authenticate")
      process.exit(1)
    }
  },
})

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage authentication",
  builder: (yargs) =>
    yargs
      .command(ClaudeLoginCommand)
      .command(ClaudeStatusCommand)
      .command(ClaudeRefreshCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})
