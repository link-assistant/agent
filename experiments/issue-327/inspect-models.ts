// Reproduce catalog/default resolution without credentials or provider requests.
import { Provider } from '../../js/src/provider/provider';
import { ModelsDev } from '../../js/src/provider/models';
import { Instance } from '../../js/src/project/instance';
import { parseModelConfig } from '../../js/src/cli/model-config.js';
import { DEFAULT_MODEL } from '../../js/src/config/defaults';

ModelsDev.get = async () => ({
  opencode: {
    id: 'opencode',
    name: 'OpenCode Zen',
    env: [],
    npm: '@ai-sdk/openai-compatible',
    api: 'https://opencode.ai/zen/v1',
    models: Object.fromEntries(
      ['minimax-m2.5-free', 'nemotron-3-super-free', 'big-pickle'].map((id) => [
        id,
        {
          id,
          name: id,
          release_date: '',
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          cost: { input: 0, output: 0 },
          limit: { context: 200000, output: 32768 },
          options: {},
        },
      ])
    ),
  },
});
await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const providers = await Provider.list();
    const parsed = await parseModelConfig(
      { model: DEFAULT_MODEL },
      () => {},
      () => {}
    );
    const exists = await Provider.hasModel('kilo', 'nemotron-3-super-free');
    const model = exists
      ? await Provider.getModel('kilo', 'nemotron-3-super-free')
      : undefined;
    const short = await Provider.resolveShortModelName('nemotron-3-super-free');
    const small = await Provider.getSmallModel('kilo');
    console.log(
      'RESULT ' +
        JSON.stringify({
          kilo: providers.kilo?.info.models,
          zen: providers.opencode?.info.models,
          defaultModel: DEFAULT_MODEL,
          apiModel: model?.language.modelId,
          short,
          small: small?.modelID,
          compaction: parsed.compactionModel,
        })
    );
  },
});
await Instance.disposeAll();
