#!/usr/bin/env bun
/**
 * Regenerate the models.dev provider table in docs/providers.md (#334).
 *
 * The agent loads its catalogue from models.dev at runtime, so this table is
 * only a snapshot for readers; `agent models` always shows the live list.
 *
 * Usage:
 *   bun scripts/generate-provider-docs.mjs            # fetch models.dev
 *   bun scripts/generate-provider-docs.mjs api.json   # use a saved copy
 *   bun scripts/generate-provider-docs.mjs --check    # fail if outdated
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const START = '<!-- providers:start -->';
const END = '<!-- providers:end -->';
const DOC = path.join(import.meta.dir, '..', 'docs', 'providers.md');

/** Providers with an `agent auth login` method besides an API key. */
const LOGINS = new Set([
  'alibaba',
  'anthropic',
  'azure',
  'digitalocean',
  'github-copilot',
  'gitlab',
  'google',
  'kilo',
  'openai',
  'poe',
  'qwen-coder',
  'xai',
]);

function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function isFree(model) {
  return model.cost?.input === 0 && model.cost?.output === 0;
}

export function renderTable(database) {
  const rows = Object.entries(database)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, provider]) => {
      const models = Object.values(provider.models ?? {});
      const env = (provider.env ?? []).map((name) => `\`${name}\``).join(', ');
      return [
        `\`${id}\``,
        cell(provider.name ?? id),
        env || '—',
        models.length,
        models.filter(isFree).length,
        LOGINS.has(id) ? 'yes' : '',
      ];
    });
  const lines = [
    '| ID | Name | Env vars | Models | Free | Login |',
    '| -- | ---- | -------- | -----: | ---: | ----- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return `${rows.length} providers.\n\n${lines.join('\n')}`;
}

/** Format like `npm run format` does, so `--check` agrees with prettier. */
async function format(markdown) {
  const prettier = await import(
    Bun.resolveSync('prettier', path.join(import.meta.dir, '..', 'js'))
  );
  const options = (await prettier.resolveConfig(DOC)) ?? {};
  return prettier.format(markdown, { ...options, filepath: DOC });
}

async function load(file) {
  if (file) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  const response = await fetch('https://models.dev/api.json');
  if (!response.ok) {
    throw new Error(`models.dev: HTTP ${response.status}`);
  }
  return response.json();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const file = args.find((arg) => !arg.startsWith('--'));
  const doc = readFileSync(DOC, 'utf8');
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(`${DOC} has no ${START} ... ${END} block`);
  }
  const next = await format(
    `${doc.slice(0, start + START.length)}\n\n${renderTable(
      await load(file)
    )}\n\n${doc.slice(end)}`
  );
  if (check) {
    if (next !== doc) {
      console.error(
        'docs/providers.md is outdated: run bun scripts/generate-provider-docs.mjs'
      );
      process.exit(1);
    }
  } else {
    writeFileSync(DOC, next);
    console.log(`updated ${path.relative(process.cwd(), DOC)}`);
  }
}
