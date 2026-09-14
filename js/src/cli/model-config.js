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
  getDefaultModel,
  getDefaultModelParts,
  getDefaultModelSource,
  getDefaultCompactionModel,
  getDefaultCompactionModelSource,
  getDefaultCompactionModels,
  getDefaultCompactionModelsSource,
  getDefaultCompactionSafetyMarginPercent,
} from './defaults.ts';
import { outputModelResolved } from './model-resolution.ts';

export class ModelResolutionError extends Error {
  constructor({ modelArgv, defaultModel }) {
    super(
      `Detected a --model flag that could not be parsed reliably from argv ${JSON.stringify(modelArgv)}. ` +
        `Refusing to continue with default model "${defaultModel}". ` +
        'Pass each option and value as a separate argv element, for example: ["--model", "provider/model", "--verbose"].'
    );
    this.name = 'ModelResolutionError';
  }
}

/**
 * Parse model config from argv. Supports "provider/model" or short "model" format.
 * @param {object} argv - Parsed command line arguments
 * @param {function} outputError - Function to output error messages
 * @param {function} outputStatus - Function to output status messages
 * @returns {Promise<{providerID: string, modelID: string}>}
 */
export async function parseModelConfig(
  argv,
  outputError,
  outputStatus,
  defaultOptions = {}
) {
  const defaultModel = getDefaultModel(defaultOptions);
  const { providerID: defaultProviderID, modelID: defaultModelID } =
    getDefaultModelParts(defaultOptions);

  // Safeguard: validate argv.model against process.argv to detect yargs/cache mismatch (#192, #196, #239)
  // This is critical because yargs under Bun may fail to parse --model correctly,
  // returning the default value instead of the user's CLI argument.
  const cliModelArg = getModelFromProcessArgv();
  let modelArg = argv.model ?? defaultModel;

  // Diagnostic logging: always log raw argv sources when debugging model resolution (#239)
  // Bun global installs may have different process.argv structure (oven-sh/bun#22157)
  Log.Default.info(() => ({
    message: 'model resolution: argv sources',
    processArgv: process.argv,
    bunArgv:
      typeof globalThis.Bun !== 'undefined' && globalThis.Bun.argv
        ? globalThis.Bun.argv
        : '(not available)',
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
  } else if (modelArg === defaultModel) {
    // cliModelArg is null AND yargs returned the default — check if process.argv
    // actually contains --model to detect silent yargs/Bun mismatch (#239)
    const rawArgvStr = process.argv.join(' ');
    if (
      rawArgvStr.includes('--model ') ||
      rawArgvStr.includes('--model=') ||
      rawArgvStr.includes('-m ') ||
      rawArgvStr.includes('-m=')
    ) {
      const modelArgv = process.argv.filter(
        (arg) => typeof arg === 'string' && /(^|\s)(--model|-m)(=|\s)/.test(arg)
      );
      throw new ModelResolutionError({
        modelArgv: modelArgv.length > 0 ? modelArgv : process.argv,
        defaultModel,
      });
    }
  }

  // Attestation inputs (#295): record what was requested, and where it came
  // from, before resolution can rewrite the effective model. `argv.model` is
  // only treated as a request when it differs from the default, because yargs
  // fills it with the default value even when no --model flag was passed.
  const argvModelArg =
    typeof argv.model === 'string' && argv.model !== defaultModel
      ? argv.model
      : null;
  const requestedModel = cliModelArg ?? argvModelArg;
  const modelSource = requestedModel
    ? 'cli'
    : getDefaultModelSource(defaultOptions);

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
    // However, if the model is the default (no --model CLI flag), warn but proceed (#239).
    // The models.dev API may lag behind the provider's actual model availability.
    const isDefaultModel = !cliModelArg && modelArg === defaultModel;
    try {
      const { Provider } = await import('../provider/provider.ts');
      const s = await Provider.state();
      const provider = s.providers[providerID];
      if (provider && !provider.info.models[modelID]) {
        const liveInfo = await Provider.refreshLiveModelInfo(
          providerID,
          modelID
        );
        if (liveInfo) {
          Log.Default.info(() => ({
            message:
              'model not found in models.dev catalog but found in provider live endpoint',
            providerID,
            modelID,
          }));
        } else {
          const availableModels = Object.keys(provider.info.models).slice(
            0,
            10
          );
          if (isDefaultModel) {
            // Default model not in models.dev catalog — warn but proceed (#239)
            // The provider may still accept it; models.dev can lag behind actual availability.
            Log.Default.warn(() => ({
              message:
                'default model not found in models.dev catalog — proceeding anyway',
              providerID,
              modelID,
              availableModels,
            }));
          } else {
            // User explicitly specified provider/model — fail with a clear error (#231)
            // Silent fallback caused kimi-k2.5-free to be routed to minimax-m2.5-free
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
        }
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
    modelID,
    defaultOptions
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
    if (providerID === defaultProviderID && modelID === defaultModelID) {
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

  // Machine-readable routing attestation (#295).
  // Emitted last inside this function, which is still the earliest point where
  // the effective model is final: --use-existing-claude-oauth above is the one
  // path that can replace an already selected model, and the attestation must
  // describe what actually runs. It is emitted before session creation and
  // before any completion request, so a consumer can terminate the run before a
  // request reaches a provider it did not ask for. Claude NDJSON streams must
  // stay one line, so that standard forces compact output regardless of
  // --compact-json.
  const usesClaudeStandard =
    argv['json-standard'] === 'claude' || argv.jsonStandard === 'claude';
  outputModelResolved(
    {
      requested: requestedModel,
      selector: modelArg,
      providerID,
      modelID,
      source: modelSource,
    },
    usesClaudeStandard || argv['compact-json'] === true ? true : undefined
  );

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
  const resolved = await Provider.resolveShortModelName(modelArg);
  if (!resolved) {
    throw new Error('ProviderModelNotFoundError');
  }
  return {
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    useSameModel: false,
  };
}

/**
 * Narrow a built-in compaction default to the provider the run was pointed at.
 *
 * The shipped cascade names OpenCode models, because the shipped base model is
 * an OpenCode one. A run launched with `--model formalai/formal-ai` inherited
 * that cascade unchanged, so compaction — and the session summary, which reuses
 * the compaction model — called a provider the operator may hold no credentials
 * for. Every one of those calls fails, and the failures read as the run having
 * failed.
 *
 * Only the *built-in* defaults are narrowed, and only for a run pointed away
 * from the built-in default provider. A cascade the operator named
 * (`--compaction-model`, `--compaction-models`, or the
 * `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL*` env vars) is an explicit
 * choice and is left alone, cross-provider or not; and a run on the shipped
 * provider keeps the shipped cascade, whose extra entries are the rate-limit
 * fallbacks it was written for.
 *
 * @param {{providerID: string, modelID: string, useSameModel: boolean}[]} entries
 * @param {string} baseProviderID Provider of the model that runs the turns
 * @param {string} baseModelID Model that runs the turns
 * @returns {{providerID: string, modelID: string, useSameModel: boolean}[]}
 * @see https://github.com/link-assistant/agent/issues/307
 */
function inheritBaseProvider(entries, baseProviderID, baseModelID) {
  const kept = entries.filter(
    (entry) => entry.useSameModel || entry.providerID === baseProviderID
  );
  const dropped = entries.filter((entry) => !kept.includes(entry));
  if (dropped.length === 0) {
    return entries;
  }

  const inherited =
    kept.length > 0
      ? kept
      : [
          {
            providerID: baseProviderID,
            modelID: baseModelID,
            useSameModel: true,
          },
        ];

  Log.Default.info(() => ({
    message: 'default compaction models narrowed to the configured provider',
    hint: 'Secondary calls (compaction, session summary) inherit --model unless a compaction model is named explicitly',
    baseProviderID,
    baseModelID,
    dropped: dropped.map((entry) => `${entry.providerID}/${entry.modelID}`),
    kept: inherited.map((entry) =>
      entry.useSameModel ? 'same' : `${entry.providerID}/${entry.modelID}`
    ),
  }));

  return inherited;
}

/**
 * Parse compaction model config from argv.
 * Supports both --compaction-model (single) and --compaction-models (cascade).
 * When --compaction-models is specified, it overrides --compaction-model.
 * The special value "same" means use the base model for compaction.
 * @see https://github.com/link-assistant/agent/issues/219
 * @see https://github.com/link-assistant/agent/issues/232
 * @see https://github.com/link-assistant/agent/issues/307
 */
async function parseCompactionModelConfig(
  argv,
  baseProviderID,
  baseModelID,
  defaultOptions = {}
) {
  const defaultCompactionSafetyMarginPercent =
    getDefaultCompactionSafetyMarginPercent(defaultOptions);

  // Get safety margin from CLI
  const cliSafetyMarginArg = getCompactionSafetyMarginFromProcessArgv();
  const compactionSafetyMarginPercent = cliSafetyMarginArg
    ? parseInt(cliSafetyMarginArg, 10)
    : (argv['compaction-safety-margin'] ??
      defaultCompactionSafetyMarginPercent);

  // Check for --compaction-models (cascade) first — it overrides --compaction-model
  const cliCompactionModelsArg = getCompactionModelsFromProcessArgv();
  const defaultCompactionModels = getDefaultCompactionModels(defaultOptions);
  const compactionModelsSource =
    cliCompactionModelsArg ||
    (argv['compaction-models'] &&
      argv['compaction-models'] !== defaultCompactionModels)
      ? 'cli'
      : 'default';
  const compactionModelsArg =
    cliCompactionModelsArg ??
    argv['compaction-models'] ??
    defaultCompactionModels;

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
        const logSkip =
          compactionModelsSource === 'default'
            ? Log.Default.debug
            : Log.Default.warn;
        logSkip(() => ({
          message: 'skipping unresolvable compaction model in cascade',
          model: name,
          error: err?.message,
        }));
      }
    }

    // A cascade nobody asked for must not reach across providers (#307).
    const usingBuiltInCascade =
      compactionModelsSource === 'default' &&
      getDefaultCompactionModelsSource(defaultOptions) === 'default' &&
      baseProviderID !== DEFAULT_PROVIDER_ID;
    const cascade = usingBuiltInCascade
      ? inheritBaseProvider(compactionModels, baseProviderID, baseModelID)
      : compactionModels;

    Log.Default.info(() => ({
      message: 'compaction models cascade configured',
      models: cascade.map((m) =>
        m.useSameModel ? 'same' : `${m.providerID}/${m.modelID}`
      ),
      source: compactionModelsSource,
    }));

    // Use the first model as the primary compaction model (for backward compatibility)
    // The full cascade is stored in compactionModels array
    const primary = cascade[0] || {
      providerID: baseProviderID,
      modelID: baseModelID,
      useSameModel: true,
    };

    return {
      providerID: primary.providerID,
      modelID: primary.modelID,
      useSameModel: primary.useSameModel,
      compactionSafetyMarginPercent,
      compactionModels: cascade,
    };
  }

  // Fallback to single --compaction-model
  const cliCompactionModelArg = getCompactionModelFromProcessArgv();
  const defaultCompactionModel = getDefaultCompactionModel(defaultOptions);
  const compactionModelSource =
    cliCompactionModelArg ||
    (argv['compaction-model'] &&
      argv['compaction-model'] !== defaultCompactionModel)
      ? 'cli'
      : 'default';
  const compactionModelArg =
    cliCompactionModelArg ?? argv['compaction-model'] ?? defaultCompactionModel;

  const resolved = await resolveCompactionModelEntry(
    compactionModelArg,
    baseProviderID,
    baseModelID
  );

  // Same rule as the cascade: an unrequested default follows --model (#307).
  const usingBuiltInCompactionModel =
    compactionModelSource === 'default' &&
    getDefaultCompactionModelSource(defaultOptions) === 'default' &&
    baseProviderID !== DEFAULT_PROVIDER_ID;
  const [entry] = usingBuiltInCompactionModel
    ? inheritBaseProvider([resolved], baseProviderID, baseModelID)
    : [resolved];

  Log.Default.info(() => ({
    message: 'using single compaction model',
    compactionProviderID: entry.providerID,
    compactionModelID: entry.modelID,
    useSameModel: entry.useSameModel,
    source: compactionModelSource,
  }));

  return {
    providerID: entry.providerID,
    modelID: entry.modelID,
    useSameModel: entry.useSameModel,
    compactionSafetyMarginPercent,
    compactionModels: [
      {
        providerID: entry.providerID,
        modelID: entry.modelID,
        useSameModel: entry.useSameModel,
      },
    ],
  };
}
