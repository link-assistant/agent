#!/usr/bin/env node
/**
 * List all models from models.dev API in provider/model format
 * Usage: node scripts/list-all-models.mjs
 *
 * Outputs: List of models in provider/model format, sorted by provider then model name
 */

async function listAllModels() {
  try {
    // Fetch model data from models.dev
    const response = await fetch('https://models.dev/api.json');
    const data = await response.json();

    const models = [];

    // Iterate through all providers
    for (const [provider, providerData] of Object.entries(data)) {
      if (providerData.models) {
        // Iterate through all models for this provider
        for (const [modelName, modelData] of Object.entries(
          providerData.models
        )) {
          models.push({
            id: `${provider}/${modelName}`,
            provider,
            model: modelName,
            toolCall: modelData.tool_call ?? true,
          });
        }
      }
    }

    // Sort by provider first, then by model name
    models.sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.model.localeCompare(b.model);
    });

    // Output for workflow usage (YAML format for GitHub Actions)
    console.log(
      '# All models from models.dev API (sorted by provider, then model name)'
    );
    models.forEach((m) => {
      console.log(`- ${m.id}`);
    });

    console.log('\n# Total models:', models.length);
    console.log(
      '# Providers:',
      [...new Set(models.map((m) => m.provider))].sort().join(', ')
    );
  } catch (error) {
    console.error(`Error fetching model data: ${error.message}`);
    process.exit(1);
  }
}

listAllModels();
