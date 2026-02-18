import { getModelFromProcessArgv } from './argv.ts';
import { Log } from '../util/log.ts';

/**
 * Parse model config from argv. Supports "provider/model" or short "model" format.
 * @param {object} argv - Parsed command line arguments
 * @param {function} outputError - Function to output error messages
 * @param {function} outputStatus - Function to output status messages
 * @returns {Promise<{providerID: string, modelID: string}>}
 */
export async function parseModelConfig(argv, outputError, outputStatus) {
  // Safeguard: validate argv.model against process.argv to detect yargs/cache mismatch (#192, #196)
  // This is critical because yargs under Bun may fail to parse --model correctly,
  // returning the default value instead of the user's CLI argument.
  const cliModelArg = getModelFromProcessArgv();
  let modelArg = argv.model;

  // ALWAYS prefer the CLI value over yargs when available (#196)
  // The yargs default 'opencode/kimi-k2.5-free' can silently override user's --model argument
  if (cliModelArg) {
    if (cliModelArg !== modelArg) {
      Log.Default.warn(() => ({
        message: 'model argument mismatch detected - using CLI value',
        yargsModel: modelArg,
        cliModel: cliModelArg,
        processArgv: process.argv.join(' '),
      }));
    }
    // Always use CLI value when available, even if it matches yargs
    // This ensures we use the actual CLI argument, not a cached/default yargs value
    modelArg = cliModelArg;
  }

  let providerID;
  let modelID;

  // Check if model includes explicit provider prefix
  if (modelArg.includes('/')) {
    // Explicit provider/model format - respect user's choice
    const modelParts = modelArg.split('/');
    providerID = modelParts[0];
    modelID = modelParts.slice(1).join('/');

    // Validate that providerID and modelID are not empty
    // Do NOT fall back to defaults - if the user provided an invalid format, fail clearly (#196)
    if (!providerID || !modelID) {
      throw new Error(
        `Invalid model format: "${modelArg}". Expected "provider/model" format (e.g., "opencode/kimi-k2.5-free"). ` +
          `Provider: "${providerID || '(empty)'}", Model: "${modelID || '(empty)'}".`
      );
    }

    // Log raw and parsed values to help diagnose model routing issues (#171)
    Log.Default.info(() => ({
      message: 'using explicit provider/model',
      rawModel: modelArg,
      providerID,
      modelID,
    }));

    // Validate that the model exists in the provider (#196)
    // Without this check, a non-existent model silently proceeds and fails at API call time
    // with confusing "reason: unknown" and zero tokens
    try {
      const { Provider } = await import('../provider/provider.ts');
      const s = await Provider.state();
      const provider = s.providers[providerID];
      if (provider && !provider.info.models[modelID]) {
        // Provider exists but model doesn't - warn and suggest alternatives
        const availableModels = Object.keys(provider.info.models).slice(0, 5);
        Log.Default.warn(() => ({
          message:
            'model not found in provider - will attempt anyway (provider may support unlisted models)',
          providerID,
          modelID,
          availableModels,
        }));
      }
    } catch (validationError) {
      // Don't fail on validation errors - the model may still work
      // This is a best-effort check
      Log.Default.info(() => ({
        message: 'skipping model existence validation',
        reason: validationError?.message,
      }));
    }
  } else {
    // Short model name - resolve to appropriate provider
    // Import Provider to use parseModelWithResolution
    const { Provider } = await import('../provider/provider.ts');
    const resolved = await Provider.parseModelWithResolution(modelArg);
    providerID = resolved.providerID;
    modelID = resolved.modelID;

    Log.Default.info(() => ({
      message: 'resolved short model name',
      input: modelArg,
      providerID,
      modelID,
    }));
  }

  // Handle --use-existing-claude-oauth option
  // This reads OAuth credentials from ~/.claude/.credentials.json (Claude Code CLI)
  // For new authentication, use: agent auth login (select Anthropic > Claude Pro/Max)
  if (argv['use-existing-claude-oauth']) {
    // Import ClaudeOAuth to check for credentials from Claude Code CLI
    const { ClaudeOAuth } = await import('../auth/claude-oauth.ts');
    const creds = await ClaudeOAuth.getCredentials();

    if (!creds?.accessToken) {
      const compactJson = argv['compact-json'] === true;
      outputError(
        {
          errorType: 'AuthenticationError',
          message:
            'No Claude OAuth credentials found in ~/.claude/.credentials.json. Either authenticate with Claude Code CLI first, or use: agent auth login (select Anthropic > Claude Pro/Max)',
        },
        compactJson
      );
      process.exit(1);
    }

    // Set environment variable for the provider to use
    process.env.CLAUDE_CODE_OAUTH_TOKEN = creds.accessToken;

    // If user specified the default model (opencode/kimi-k2.5-free), switch to claude-oauth
    // If user explicitly specified kilo or another provider, warn but respect their choice
    if (providerID === 'opencode' && modelID === 'kimi-k2.5-free') {
      providerID = 'claude-oauth';
      modelID = 'claude-sonnet-4-5';
    } else if (!['claude-oauth', 'anthropic'].includes(providerID)) {
      // If user specified a different provider explicitly, warn them
      const compactJson = argv['compact-json'] === true;
      outputStatus(
        {
          type: 'warning',
          message: `--use-existing-claude-oauth is set but model uses provider "${providerID}". Using specified provider.`,
        },
        compactJson
      );
      // Don't override - respect user's explicit provider choice
    }
  }

  return { providerID, modelID };
}
