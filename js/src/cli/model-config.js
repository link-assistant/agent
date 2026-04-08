import {
  getModelFromProcessArgv,
  getCompactionModelFromProcessArgv,
  getCompactionModelsFromProcessArgv,
  getCompactionSafetyMarginFromProcessArgv,
} from './argv.ts';
import { Log } from '../util/log.ts';
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_COMPACTION_MODEL,
  DEFAULT_COMPACTION_MODELS,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT,
} from './defaults.ts';

/**
 * Parse model config from argv. Supports "provider/model" or short "model" format.
 * @param {object} argv - Parsed command line arguments
 * @param {function} outputError - Function to output error messages
 * @param {function} outputStatus - Function to output status messages
 * @returns {Promise<{providerID: string, modelID: string}>}
 */
export async function parseModelConfig(argv, outputError, outputStatus) {
  // Safeguard: validate argv.model against process.argv to detect yargs/cache mismatch (#192, #196, #239)
  // This is critical because yargs under Bun may fail to parse --model correctly,
  // returning the default value instead of the user's CLI argument.
  const cliModelArg = getModelFromProcessArgv();
  let modelArg = argv.model;

  // Diagnostic logging: always log raw argv sources when debugging model resolution (#239)
  // Bun global installs may have different process.argv structure (oven-sh/bun#22157)
  Log.Default.info(() => ({
    message: 'model resolution: argv sources',
    processArgv: process.argv,
    bunArgv: typeof globalThis.Bun !== 'undefined' && globalThis.Bun.argv ? globalThis.Bun.argv : '(not available)',
    cliModelArg: cliModelArg ?? '(null - not found in argv)',
    yargsModel: modelArg,
  }));

  // ALWAYS prefer the CLI value over yargs when available (#196)
  // The yargs default (DEFAULT_MODEL) can silently override user's --model argument
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
  } else if (modelArg === `${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID}`) {
    // cliModelArg is null AND yargs returned the default — check if process.argv
    // actually contains --model to detect silent yargs/Bun mismatch (#239)
    const rawArgvStr = process.argv.join(' ');
    if (rawArgvStr.includes('--model ') || rawArgvStr.includes('--model=') ||
        rawArgvStr.includes('-m ') || rawArgvStr.includes('-m=')) {
      Log.Default.error(() => ({
        message: 'CRITICAL: --model flag detected in process.argv but both getModelFromProcessArgv() and yargs returned default. ' +
          'This is likely a Bun/yargs argument parsing bug (oven-sh/bun#22157). ' +
          'The requested model will NOT be used — the default model will be used instead.',
        processArgv: process.argv,
        bunArgv: typeof globalThis.Bun !== 'undefined' && globalThis.Bun.argv ? globalThis.Bun.argv : '(not available)',
        defaultModel: `${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID}`,
      }));
    }
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
        `Invalid model format: "${modelArg}". Expected "provider/model" format (e.g., "${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID}"). ` +
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

    // Validate that the model exists in the provider (#196, #231)
    // If user explicitly specified provider/model and the model is not found,
    // fail immediately instead of silently falling back to a different model.
    try {
      const { Provider } = await import('../provider/provider.ts');
      const s = await Provider.state();
      const provider = s.providers[providerID];
      if (provider && !provider.info.models[modelID]) {
        // Provider exists but model doesn't — fail with a clear error (#231)
        // Silent fallback caused kimi-k2.5-free to be routed to minimax-m2.5-free
        const availableModels = Object.keys(provider.info.models).slice(0, 10);
        Log.Default.error(() => ({
          message:
            'model not found in provider — refusing to proceed with explicit provider/model',
          providerID,
          modelID,
          availableModels,
        }));
        throw new Error(
          `Model "${modelID}" not found in provider "${providerID}". ` +
            `Available models include: ${availableModels.join(', ')}. ` +
            `Use --model ${providerID}/<model-id> with a valid model, or omit the provider prefix for auto-resolution.`
        );
      }
    } catch (validationError) {
      // Re-throw if this is our own validation error (not an infrastructure issue)
      if (validationError?.message?.includes('not found in provider')) {
        throw validationError;
      }
      // For infrastructure errors (e.g. can't load provider state), log and continue
      Log.Default.info(() => ({
        message:
          'skipping model existence validation due to infrastructure error',
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

  // Parse compaction model (#219)
  const compactionModelResult = await parseCompactionModelConfig(
    argv,
    providerID,
    modelID
  );

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

    // If user specified the default model (DEFAULT_MODEL), switch to claude-oauth
    // If user explicitly specified kilo or another provider, warn but respect their choice
    if (providerID === DEFAULT_PROVIDER_ID && modelID === DEFAULT_MODEL_ID) {
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

  return { providerID, modelID, compactionModel: compactionModelResult };
}

/**
 * Parse a links notation references sequence string into an array of model names.
 * Format: "(model1 model2 model3)" — parenthesized space-separated list.
 * @param {string} notation - Links notation sequence string
 * @returns {string[]} Array of model name strings
 * @see https://github.com/link-assistant/agent/issues/232
 */
function parseLinksNotationSequence(notation) {
  const trimmed = notation.trim();
  // Remove surrounding parentheses if present
  const inner =
    trimmed.startsWith('(') && trimmed.endsWith(')')
      ? trimmed.slice(1, -1)
      : trimmed;
  // Split on whitespace and filter empty strings
  return inner.split(/\s+/).filter((s) => s.length > 0);
}

/**
 * Resolve a single compaction model entry (short name, provider/model, or "same").
 * @returns {{ providerID: string, modelID: string, useSameModel: boolean }}
 */
async function resolveCompactionModelEntry(
  modelArg,
  baseProviderID,
  baseModelID
) {
  const useSameModel = modelArg.toLowerCase() === 'same';

  if (useSameModel) {
    return {
      providerID: baseProviderID,
      modelID: baseModelID,
      useSameModel: true,
    };
  }

  if (modelArg.includes('/')) {
    const parts = modelArg.split('/');
    return {
      providerID: parts[0],
      modelID: parts.slice(1).join('/'),
      useSameModel: false,
    };
  }

  // Short name resolution
  const { Provider } = await import('../provider/provider.ts');
  const resolved = await Provider.parseModelWithResolution(modelArg);
  return {
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    useSameModel: false,
  };
}

/**
 * Parse compaction model config from argv.
 * Supports both --compaction-model (single) and --compaction-models (cascade).
 * When --compaction-models is specified, it overrides --compaction-model.
 * The special value "same" means use the base model for compaction.
 * @see https://github.com/link-assistant/agent/issues/219
 * @see https://github.com/link-assistant/agent/issues/232
 */
async function parseCompactionModelConfig(argv, baseProviderID, baseModelID) {
  // Get safety margin from CLI
  const cliSafetyMarginArg = getCompactionSafetyMarginFromProcessArgv();
  const compactionSafetyMarginPercent = cliSafetyMarginArg
    ? parseInt(cliSafetyMarginArg, 10)
    : (argv['compaction-safety-margin'] ??
      DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT);

  // Check for --compaction-models (cascade) first — it overrides --compaction-model
  const cliCompactionModelsArg = getCompactionModelsFromProcessArgv();
  const compactionModelsArg =
    cliCompactionModelsArg ??
    argv['compaction-models'] ??
    DEFAULT_COMPACTION_MODELS;

  // Parse the links notation sequence into an array of model names
  const modelNames = parseLinksNotationSequence(compactionModelsArg);

  if (modelNames.length > 0) {
    // Resolve each model in the cascade
    const compactionModels = [];
    for (const name of modelNames) {
      try {
        const resolved = await resolveCompactionModelEntry(
          name,
          baseProviderID,
          baseModelID
        );
        compactionModels.push({
          providerID: resolved.providerID,
          modelID: resolved.modelID,
          useSameModel: resolved.useSameModel,
        });
      } catch (err) {
        // If a model can't be resolved, log and skip it
        Log.Default.warn(() => ({
          message: 'skipping unresolvable compaction model in cascade',
          model: name,
          error: err?.message,
        }));
      }
    }

    Log.Default.info(() => ({
      message: 'compaction models cascade configured',
      models: compactionModels.map((m) =>
        m.useSameModel ? 'same' : `${m.providerID}/${m.modelID}`
      ),
      source: cliCompactionModelsArg ? 'cli' : 'default',
    }));

    // Use the first model as the primary compaction model (for backward compatibility)
    // The full cascade is stored in compactionModels array
    const primary = compactionModels[0] || {
      providerID: baseProviderID,
      modelID: baseModelID,
      useSameModel: true,
    };

    return {
      providerID: primary.providerID,
      modelID: primary.modelID,
      useSameModel: primary.useSameModel,
      compactionSafetyMarginPercent,
      compactionModels,
    };
  }

  // Fallback to single --compaction-model
  const cliCompactionModelArg = getCompactionModelFromProcessArgv();
  const compactionModelArg =
    cliCompactionModelArg ??
    argv['compaction-model'] ??
    DEFAULT_COMPACTION_MODEL;

  const resolved = await resolveCompactionModelEntry(
    compactionModelArg,
    baseProviderID,
    baseModelID
  );

  Log.Default.info(() => ({
    message: 'using single compaction model',
    compactionProviderID: resolved.providerID,
    compactionModelID: resolved.modelID,
    useSameModel: resolved.useSameModel,
  }));

  return {
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    useSameModel: resolved.useSameModel,
    compactionSafetyMarginPercent,
    compactionModels: [
      {
        providerID: resolved.providerID,
        modelID: resolved.modelID,
        useSameModel: resolved.useSameModel,
      },
    ],
  };
}
