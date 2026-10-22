import type { Argv } from 'yargs';
import { Instance } from '../../project/instance';
import { Provider } from '../../provider/provider';
import { ModelsDev } from '../../provider/models';
import { ModelDiscovery } from '../../provider/model-discovery';
import { ExtraProviders } from '../../provider/extra-providers';
import { cmd } from './cmd';
import { UI } from '../ui';
import { EOL } from 'os';

function isFree(model: ModelsDev.Model) {
  return model.cost?.input === 0 && model.cost?.output === 0;
}

export const ModelsCommand = cmd({
  command: 'models [provider]',
  describe: 'list all available models',
  builder: (yargs: Argv) => {
    return yargs
      .positional('provider', {
        describe: 'provider ID to filter models by',
        type: 'string',
        array: false,
      })
      .option('verbose', {
        describe:
          'use more verbose model output (includes metadata like costs)',
        type: 'boolean',
      })
      .option('discover', {
        describe:
          "also list models from each provider's own /models endpoint (cached for an hour)",
        type: 'boolean',
      })
      .option('refresh', {
        describe:
          'refetch the models.dev catalogue and provider model listings, ignoring caches (implies --discover)',
        type: 'boolean',
      })
      .option('free', {
        describe: 'only list models that cost nothing to use',
        type: 'boolean',
      });
  },
  handler: async (args) => {
    if (args.refresh) await ModelsDev.refresh();
    const discover = Boolean(args.discover || args.refresh);

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        async function printModels(providerID: string) {
          const provider = await Provider.getProvider(providerID);
          if (!provider) return false;
          const models: Record<string, ModelsDev.Model> = {
            ...provider.info.models,
          };
          const unpriced = new Set<string>();
          const keyless = ExtraProviders.isKeyless(provider.info.id);
          if (discover) {
            const result = await Provider.discoverModels(providerID, {
              force: Boolean(args.refresh),
            });
            if (result.status === 'error') {
              UI.error(
                `${providerID}: model discovery failed: ${result.error}`
              );
            }
            const s = await Provider.state();
            for (const found of result.models) {
              if (models[found.id]) continue;
              const metadata = ModelDiscovery.catalogueMetadata(
                s.database,
                found.id,
                provider.info.id
              );
              // A listing without prices says nothing about the cost, except
              // on keyless providers (gpt4free, local servers), which are free.
              if (!keyless && !found.free && !found.cost && !metadata?.cost) {
                unpriced.add(found.id);
              }
              models[found.id] = ModelDiscovery.toModelInfo(found, {
                metadata,
              });
            }
          }
          for (const [modelID, model] of Object.entries(models)) {
            if (args.free && (unpriced.has(modelID) || !isFree(model)))
              continue;
            process.stdout.write(`${provider.info.id}/${modelID}`);
            process.stdout.write(EOL);
            if (args.verbose) {
              process.stdout.write(JSON.stringify(model, null, 2));
              process.stdout.write(EOL);
            }
          }
          return true;
        }

        if (args.provider) {
          if (!(await printModels(args.provider))) {
            UI.error(`Provider not found: ${args.provider}`);
          }
          return;
        }

        const providers = await Provider.list();
        for (const providerID of Object.keys(providers)) {
          await printModels(providerID);
        }
      },
    });
  },
});
