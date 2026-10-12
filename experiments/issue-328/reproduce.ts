import { readFileSync } from 'node:fs';
import {
  shippedModelIDs,
  unavailableModels,
} from '../../scripts/check-default-models.mjs';

// Replay catalogue evidence without depending on network access or inference.
const evidence = JSON.parse(
  readFileSync(new URL('./catalogue-evidence.json', import.meta.url), 'utf8')
);
const zenIDs = new Set<string>(
  evidence.models.filter((model) => model.servedByZen).map((model) => model.id)
);
const modelsDev = {
  opencode: {
    models: Object.fromEntries(
      evidence.models.map((model) => [
        model.id,
        { status: model.modelsDevStatus },
      ])
    ),
  },
};
const originalModels = [
  'opencode/minimax-m2.5-free',
  'opencode/big-pickle',
  'opencode/nemotron-3-super-free',
  'opencode/hy3-preview-free',
  'opencode/ling-2.6-flash-free',
  'opencode/gpt-5-nano',
];
console.log(
  'Original defaults unavailable:',
  unavailableModels(originalModels, zenIDs, modelsDev)
);
const missing = unavailableModels(shippedModelIDs(), zenIDs, modelsDev);
console.log('Current defaults unavailable:', missing);
if (missing.length > 0) process.exitCode = 1;
