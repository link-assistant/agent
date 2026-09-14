import { initConfig, resetConfig } from '../../js/src/config/config.ts';
import { Instance } from '../../js/src/project/instance.ts';
import { Provider } from '../../js/src/provider/provider.ts';
import { ModelsDev } from '../../js/src/provider/models.ts';
import { SessionCompaction } from '../../js/src/session/compaction.ts';

process.argv = ['bun', 'agent', '--model', 'formalai/formal-ai'];
resetConfig();
initConfig(process.argv);

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const model = await Provider.getModel('formalai', 'formal-ai');
    console.log(
      'RESULT ' +
        JSON.stringify({
          limit: model.info.limit,
          unlimited: model.info.unlimited ?? null,
          hasUnlimited: ModelsDev.hasUnlimitedContext(model.info),
          overflow: SessionCompaction.isOverflow({
            tokens: {
              input: 10_000_000,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            } as any,
            model: model.info,
          }),
          diagnostics:
            SessionCompaction.contextDiagnostics({
              tokens: { input: 10_000_000, output: 0, cache: { read: 0 } },
              model: model.info,
            }) ?? null,
        })
    );
  },
});
await Instance.disposeAll();
