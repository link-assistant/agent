#!/usr/bin/env bun

/** Check shipped defaults against provider catalogues without making inference calls. */
import {
  DEFAULT_MODEL,
  DEFAULT_COMPACTION_MODEL,
  DEFAULT_COMPACTION_MODELS,
  parseModelParts,
} from '../js/src/config/defaults.ts';
import { Kilo } from '../js/src/provider/kilo.ts';
import { catalogIDs } from './model-catalog.mjs';

export const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const KILO_MODELS_URL = Kilo.MODELS_URL;

// Read constants directly: local environment overrides must not hide stale defaults.
export function shippedModelIDs() {
  const providerID = parseModelParts(DEFAULT_MODEL).providerID;
  const cascade = DEFAULT_COMPACTION_MODELS.trim()
    .replace(/^\(|\)$/g, '')
    .split(/\s+/);
  return [
    ...new Set(
      [DEFAULT_MODEL, DEFAULT_COMPACTION_MODEL, ...cascade].map((model) =>
        model.toLowerCase() === 'same'
          ? DEFAULT_MODEL
          : model.includes('/')
            ? model
            : `${providerID}/${model}`
      )
    ),
  ];
}

export function unavailableModels(
  models,
  zenIDs,
  modelsDev,
  kiloIDs = new Set()
) {
  return models.filter((model) => {
    const { providerID, modelID } = parseModelParts(model);
    if (providerID === 'opencode' && zenIDs.has(modelID)) {
      return false;
    }
    if (
      providerID === 'kilo' &&
      kiloIDs.has(Kilo.FREE_MODELS[modelID]?.id ?? modelID)
    ) {
      return false;
    }
    const metadata = modelsDev[providerID]?.models?.[modelID];
    return !metadata || metadata.status === 'deprecated';
  });
}

async function fetchCatalogue(url, fetchFn) {
  const response = await fetchFn(url, {
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (url !== MODELS_DEV_URL) {
    return catalogIDs(body, url);
  }
  if (!body?.opencode?.models || typeof body.opencode.models !== 'object') {
    throw new Error(`${url}: missing OpenCode model metadata`);
  }
  return body;
}

export async function checkDefaultModels({
  fetchFn = fetch,
  models = shippedModelIDs(),
  warn = console.warn,
} = {}) {
  const urls = [ZEN_MODELS_URL, MODELS_DEV_URL];
  if (models.some((model) => parseModelParts(model).providerID === 'kilo')) {
    urls.push(KILO_MODELS_URL);
  }
  const results = await Promise.allSettled(
    urls.map((url) => fetchCatalogue(url, fetchFn))
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      warn(`Catalogue unavailable: ${result.reason.message}`);
    }
  }
  const zenIDs =
    results[0].status === 'fulfilled' ? results[0].value : new Set();
  const modelsDev = results[1].status === 'fulfilled' ? results[1].value : {};
  const kiloIDs =
    results[2]?.status === 'fulfilled' ? results[2].value : new Set();
  const missing = unavailableModels(models, zenIDs, modelsDev, kiloIDs);
  if (missing.length > 0) {
    throw new Error(
      `Unavailable shipped models: ${missing.join(', ')}. ` +
        `Each must be listed in its provider catalogue (${urls.filter((url) => url !== MODELS_DEV_URL).join(', ')}) or have non-deprecated metadata at ${MODELS_DEV_URL}.`
    );
  }
  return models;
}

if (import.meta.main) {
  try {
    const models = await checkDefaultModels();
    console.log(`Default model catalogue check passed: ${models.join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
