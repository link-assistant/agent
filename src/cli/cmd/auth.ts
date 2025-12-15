import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Auth } from "../../auth"
import { AuthPlugins } from "../../auth/plugins"
import { ModelsDev } from "../../provider/models"
import * as prompts from "@clack/prompts"
import path from "path"
import os from "os"
import { Global } from "../../global"
import { map, pipe, sortBy, values } from "remeda"

/**
 * Auth Command
 *
 * Manages authentication for various providers.
 * Based on OpenCode's auth implementation supporting:
 * - OAuth providers (Anthropic Claude Pro/Max, GitHub Copilot)
 * - API key providers (OpenAI, Anthropic API, etc.)
 */

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured credentials",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = await Auth.all().then((x) => Object.entries(x))
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs: Argv) =>
    yargs.positional("url", {
      describe: "wellknown auth provider URL",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Add credential")

    // Handle wellknown URL login
    if (args.url) {
      try {
        const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json() as any)
        prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
        const proc = Bun.spawn({
          cmd: wellknown.auth.command,
          stdout: "pipe",
        })
        const exit = await proc.exited
        if (exit !== 0) {
          prompts.log.error("Failed")
          prompts.outro("Done")
          return
        }
        const token = await new Response(proc.stdout).text()
        await Auth.set(args.url as string, {
          type: "wellknown",
          key: wellknown.auth.env,
          token: token.trim(),
        })
        prompts.log.success("Logged into " + args.url)
        prompts.outro("Done")
        return
      } catch (error) {
        prompts.log.error(`Failed to fetch wellknown from ${args.url}: ${error}`)
        prompts.outro("Failed")
        return
      }
    }

    // Refresh models database
    await ModelsDev.refresh().catch(() => {})
    const providers = await ModelsDev.get()

    // Provider priority (lower = higher priority)
    const priority: Record<string, number> = {
      anthropic: 0,
      "github-copilot": 1,
      openai: 2,
      google: 3,
      openrouter: 4,
      vercel: 5,
    }

    let provider = await prompts.autocomplete({
      message: "Select provider",
      maxItems: 8,
      options: [
        ...pipe(
          providers,
          values(),
          sortBy(
            (x) => priority[x.id] ?? 99,
            (x) => x.name ?? x.id,
          ),
          map((x) => ({
            label: x.name,
            value: x.id,
            hint: priority[x.id] === 0 ? "recommended" : undefined,
          })),
        ),
        {
          value: "other",
          label: "Other",
        },
      ],
    })

    if (prompts.isCancel(provider)) throw new UI.CancelledError()

    // Check if there's a plugin for this provider
    const plugin = AuthPlugins.getPlugin(provider)

    if (plugin && plugin.methods.length > 0) {
      // Select login method if multiple available
      let methodIndex = 0
      if (plugin.methods.length > 1) {
        const method = await prompts.select({
          message: "Login method",
          options: plugin.methods.map((m, index) => ({
            label: m.label,
            value: index.toString(),
          })),
        })
        if (prompts.isCancel(method)) throw new UI.CancelledError()
        methodIndex = parseInt(method)
      }

      const method = plugin.methods[methodIndex]

      // Handle prompts for auth method
      await new Promise((resolve) => setTimeout(resolve, 10))
      const inputs: Record<string, string> = {}

      if (method.prompts) {
        for (const prompt of method.prompts) {
          if (prompt.condition && !prompt.condition(inputs)) {
            continue
          }
          if (prompt.type === "select") {
            const value = await prompts.select({
              message: prompt.message,
              options: prompt.options!,
            })
            if (prompts.isCancel(value)) throw new UI.CancelledError()
            inputs[prompt.key] = value
          } else {
            const value = await prompts.text({
              message: prompt.message,
              placeholder: prompt.placeholder,
              validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
            })
            if (prompts.isCancel(value)) throw new UI.CancelledError()
            inputs[prompt.key] = value
          }
        }
      }

      if (method.type === "oauth") {
        const authorize = await method.authorize!(inputs)

        if (authorize.url) {
          prompts.log.info("Go to: " + authorize.url)
        }

        if (authorize.method === "auto") {
          if (authorize.instructions) {
            prompts.log.info(authorize.instructions)
          }
          const spinner = prompts.spinner()
          spinner.start("Waiting for authorization...")
          const result = await authorize.callback()
          if (result.type === "failed") {
            spinner.stop("Failed to authorize", 1)
          }
          if (result.type === "success") {
            const saveProvider = result.provider ?? provider
            if ("refresh" in result) {
              const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
              await Auth.set(saveProvider, {
                type: "oauth",
                refresh,
                access,
                expires,
                ...extraFields,
              } as Auth.Info)
            }
            if ("key" in result) {
              await Auth.set(saveProvider, {
                type: "api",
                key: result.key,
              })
            }
            spinner.stop("Login successful")
          }
        }

        if (authorize.method === "code") {
          const code = await prompts.text({
            message: "Paste the authorization code here: ",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(code)) throw new UI.CancelledError()
          const result = await authorize.callback(code)
          if (result.type === "failed") {
            prompts.log.error("Failed to authorize")
          }
          if (result.type === "success") {
            const saveProvider = result.provider ?? provider
            if ("refresh" in result) {
              const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
              await Auth.set(saveProvider, {
                type: "oauth",
                refresh,
                access,
                expires,
                ...extraFields,
              } as Auth.Info)
            }
            if ("key" in result) {
              await Auth.set(saveProvider, {
                type: "api",
                key: result.key,
              })
            }
            prompts.log.success("Login successful")
          }
        }

        prompts.outro("Done")
        return
      }

      if (method.type === "api" && method.authorize) {
        const result = await method.authorize(inputs)
        if (result.type === "failed") {
          prompts.log.error("Failed to authorize")
        }
        if (result.type === "success") {
          const saveProvider = result.provider ?? provider
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key!,
          })
          prompts.log.success("Login successful")
        }
        prompts.outro("Done")
        return
      }
    }

    // Handle "other" provider
    if (provider === "other") {
      const customProvider = await prompts.text({
        message: "Enter provider id",
        validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
      })
      if (prompts.isCancel(customProvider)) throw new UI.CancelledError()
      provider = customProvider.replace(/^@ai-sdk\//, "")
      prompts.log.warn(
        `This only stores a credential for ${provider} - you may need to configure it in your config file.`,
      )
    }

    // Amazon Bedrock uses environment variables
    if (provider === "amazon-bedrock") {
      prompts.log.info(
        "Amazon Bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
      )
      prompts.outro("Done")
      return
    }

    // Provider-specific instructions for getting API keys
    const apiKeyUrls: Record<string, string> = {
      openai: "https://platform.openai.com/api-keys",
      anthropic: "https://console.anthropic.com/settings/keys",
      google: "https://aistudio.google.com/app/apikey",
      vercel: "https://vercel.link/ai-gateway-token",
      openrouter: "https://openrouter.ai/keys",
      groq: "https://console.groq.com/keys",
      mistral: "https://console.mistral.ai/api-keys",
      cohere: "https://dashboard.cohere.com/api-keys",
      perplexity: "https://www.perplexity.ai/settings/api",
      togetherai: "https://api.together.xyz/settings/api-keys",
      deepseek: "https://platform.deepseek.com/api_keys",
      xai: "https://console.x.ai",
    }

    if (apiKeyUrls[provider]) {
      prompts.log.info(`You can create an API key at ${apiKeyUrls[provider]}`)
    }

    // Fallback: prompt for API key
    const key = await prompts.password({
      message: "Enter your API key",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(key)) throw new UI.CancelledError()
    await Auth.set(provider, {
      type: "api",
      key,
    })

    prompts.outro("Done")
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      prompts.outro("Done")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})

export const AuthStatusCommand = cmd({
  command: "status",
  describe: "check authentication status for all providers (experimental)",
  async handler() {
    UI.empty()
    prompts.intro("Authentication Status")

    const credentials = await Auth.all()
    const database = await ModelsDev.get()

    if (Object.keys(credentials).length === 0) {
      prompts.log.warning("No credentials configured")
      prompts.outro("Run 'agent auth login' to authenticate")
      return
    }

    for (const [providerID, cred] of Object.entries(credentials)) {
      const name = database[providerID]?.name || providerID

      if (cred.type === "oauth") {
        const isExpired = cred.expires < Date.now()
        const expiresIn = cred.expires - Date.now()
        const expiresStr = isExpired
          ? "expired"
          : expiresIn < 3600000
            ? `${Math.round(expiresIn / 60000)} minutes`
            : `${Math.round(expiresIn / 3600000)} hours`

        if (isExpired) {
          prompts.log.warning(`${name}: OAuth token expired (will auto-refresh on next use)`)
        } else {
          prompts.log.success(`${name}: OAuth authenticated (expires in ${expiresStr})`)
        }
      } else if (cred.type === "api") {
        prompts.log.success(`${name}: API key configured`)
      } else if (cred.type === "wellknown") {
        prompts.log.success(`${name}: WellKnown token configured`)
      }
    }

    prompts.outro("Done")
  },
})

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(AuthStatusCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})
