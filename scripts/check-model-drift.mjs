#!/usr/bin/env bun
import { OpenCodeZen } from '../js/src/provider/opencode-zen.ts';
import { Kilo } from '../js/src/provider/kilo.ts';
import { fetchCatalog, missingModels } from './model-catalog.mjs';

const catalogs = [
  {
    provider: 'opencode',
    url: OpenCodeZen.MODELS_URL,
    models: Object.fromEntries(
      Object.keys(OpenCodeZen.FREE_MODEL_OVERRIDES).map((id) => [id, { id }])
    ),
  },
  { provider: 'kilo', url: Kilo.MODELS_URL, models: Kilo.FREE_MODELS },
];

let failed = false;
for (const { provider, url, models } of catalogs) {
  try {
    const live = await fetchCatalog(url, provider);
    const missing = missingModels(models, live);
    console.log(
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        provider,
        url,
        liveCount: live.size,
        builtinCount: Object.keys(models).length,
        missing,
      })
    );
    if (missing.length > 0) {
      failed = true;
      console.error(
        `${provider}: withdrawn built-in model(s): ${missing.join(', ')}`
      );
    }
  } catch (error) {
    failed = true;
    console.error(error.message);
  }
}
process.exitCode = failed ? 1 : 0;
