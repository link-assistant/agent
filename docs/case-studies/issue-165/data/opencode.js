// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/provider/provider.ts

import { createOpenCode } from '@opencode-ai/sdk';

class OpenCodeProvider {
  constructor() {
    this.name = 'opencode';
  }

  getModel(modelId) {
    // For grok-code, return a model that uses the opencode API
    if (modelId === 'grok-code') {
      return {
        id: 'grok-code',
        provider: this,
        generateText: async (options) => {
          // Use opencode API
          const opencode = await createOpenCode();
          const { client } = opencode;

          const sessionResult = await client.session.create();
          const sessionId = sessionResult.data?.id;

          await client.session.prompt({
            path: { id: sessionId },
            body: {
              agent: 'build',
              model: { providerID: 'opencode', modelID: 'grok-code' },
              parts: [{ type: 'text', text: options.prompt }],
            },
          });

          // For simplicity, return a mock response
          return {
            text: 'Hello from Grok Code!',
            usage: { promptTokens: 10, completionTokens: 5 },
          };
        },
      };
    }
    throw new Error(`Model ${modelId} not found`);
  }
}

const opencodeProvider = new OpenCodeProvider();

export { opencodeProvider };
