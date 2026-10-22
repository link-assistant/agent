// Smoke test: provider state after the #334 wiring (no network calls needed
// beyond models.dev cache). Usage: bun experiments/issue-334/smoke-state.ts
import { Instance } from '../../js/src/project/instance';
import { Provider } from '../../js/src/provider/provider';

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const s = await Provider.state();
    console.log('providers:', Object.keys(s.providers).sort().join(', '));
    console.log('database has gpt4free:', Boolean(s.database['gpt4free']));
    console.log('kilo models:', Object.keys(s.database['kilo'].models).length);
    console.log('gpt4free active before:', Boolean(s.providers['gpt4free']));
    const p = await Provider.getProvider('g4f');
    console.log('g4f ->', p?.info.id, p?.options.baseURL);
    console.log(
      'hasModel gpt4free/anything:',
      await Provider.hasModel('gpt4free', 'anything')
    );
    const m = await Provider.getModel('gpt4free', 'gpt-4o-mini');
    console.log(
      'model:',
      m.providerID,
      m.modelID,
      m.npm,
      (m.language as any).modelId,
      (m.language as any).config?.url?.({ path: '/chat/completions' })
    );
    const cf = s.database['cloudflare-ai-gateway'];
    console.log('cf npm/api:', cf?.npm, cf?.api);
  },
});
