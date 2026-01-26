#!/usr/bin/env node
/**
 * Get model information from models.dev API
 * Usage: node scripts/get-model-info.mjs <provider> <model>
 * Example: node scripts/get-model-info.mjs groq llama-3.3-70b-versatile
 *
 * Outputs: model_id and tool_call support (true/false)
 */

const provider = process.argv[2];
const model = process.argv[3];

if (!provider || !model) {
  console.error('Error: Provider and model are required');
  console.error('Usage: node scripts/get-model-info.mjs <provider> <model>');
  process.exit(1);
}

const modelId = `${provider}/${model}`;

async function getModelInfo() {
  try {
    // Fetch model data from models.dev
    const response = await fetch('https://models.dev/api.json');
    const data = await response.json();

    // Get model data
    const modelData = data?.[provider]?.models?.[model];

    if (modelData) {
      const toolCall = modelData.tool_call ?? true; // Default to true if not specified
      console.log(`model_id=${modelId}`);
      console.log(`tool_call=${toolCall}`);
      process.exit(0);
    } else {
      console.error(
        `Model data not found for ${modelId}, assuming tool_call=true`
      );
      console.log(`model_id=${modelId}`);
      console.log(`tool_call=true`);
      process.exit(0);
    }
  } catch (error) {
    console.error(`Error fetching model data: ${error.message}`);
    console.error('Assuming tool_call=true for known providers');
    console.log(`model_id=${modelId}`);
    console.log(`tool_call=true`);
    process.exit(0);
  }
}

getModelInfo();
