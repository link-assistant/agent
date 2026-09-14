/**
 * Print which model the secondary calls (compaction + session summary) would
 * use for a given `--model` selector, using the shipped defaults.
 *
 * Usage (from the `js` directory):
 *   bun run ../experiments/issue-307/print-secondary-models.ts formalai/formal-ai
 *
 * @see https://github.com/link-assistant/agent/issues/307
 */
import { parseModelConfig } from '../../js/src/cli/model-config.js';
import { initConfig, resetConfig } from '../../js/src/config/config.ts';
import { Instance } from '../../js/src/project/instance.ts';

const selector = process.argv[2] ?? 'formalai/formal-ai';

process.argv = ['bun', 'agent', '--model', selector];
resetConfig();
initConfig(process.argv);

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const parsed = await parseModelConfig(
      { model: selector },
      () => {},
      () => {}
    );
    console.log(
      JSON.stringify(
        {
          base: `${parsed.providerID}/${parsed.modelID}`,
          compactionPrimary: `${parsed.compactionModel.providerID}/${parsed.compactionModel.modelID}`,
          useSameModel: parsed.compactionModel.useSameModel,
          cascade: parsed.compactionModel.compactionModels.map((m: any) =>
            m.useSameModel
              ? `same(${m.providerID}/${m.modelID})`
              : `${m.providerID}/${m.modelID}`
          ),
        },
        null,
        2
      )
    );
  },
});

await Instance.disposeAll();
