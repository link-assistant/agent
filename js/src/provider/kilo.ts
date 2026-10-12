import type { ModelsDev } from './models';

/** Built-in aliases use exact IDs from https://api.kilo.ai/api/gateway/models. */
export namespace Kilo {
  export const MODELS_URL = 'https://api.kilo.ai/api/gateway/models';

  function freeModel(
    id: string,
    name: string,
    context: number,
    output: number
  ): ModelsDev.Model {
    return {
      id,
      name,
      release_date: '',
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context, output },
      modalities: { input: ['text'], output: ['text'] },
      options: {},
    };
  }

  // Super's output cap is deliberately conservative for existing integrations.
  export const FREE_MODELS: Record<string, ModelsDev.Model> = {
    'nemotron-3-super-free': freeModel(
      'nvidia/nemotron-3-super-120b-a12b:free',
      'Nemotron 3 Super (Free)',
      262144,
      32768
    ),
    'nemotron-3-ultra-free': freeModel(
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'Nemotron 3 Ultra (Free)',
      1000000,
      65536
    ),
    'nemotron-3.5-lightning-free': freeModel(
      'nvidia/nemotron-3.5-lightning:free',
      'Nemotron 3.5 Lightning (Free)',
      1000000,
      65536
    ),
  };
}
