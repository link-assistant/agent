// Refresh direct packages while respecting documented compatibility pins.
// Preview: node experiments/issue-328/refresh-npm-dependencies.mjs
// Apply:   node experiments/issue-328/refresh-npm-dependencies.mjs --write
import { readFileSync, writeFileSync } from 'node:fs';

const manifestURL = new URL('../../js/package.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestURL, 'utf8'));
const entries = ['dependencies', 'devDependencies'].flatMap((section) =>
  Object.entries(manifest[section]).map(([name, version]) => ({
    section,
    name,
    version,
  }))
);
const updates = [];
let next = 0;

await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < entries.length) {
      const { section, name, version } = entries[next++];
      if (manifest.dependencyPins?.[name]) continue;
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const metadata = await response.json();
      if (typeof metadata.version !== 'string') {
        throw new Error(`${name}: registry response has no version`);
      }
      const updated = `${version.startsWith('^') ? '^' : ''}${metadata.version}`;
      if (version === updated) continue;
      updates.push({ section, name, before: version, after: updated });
      manifest[section][name] = updated;
    }
  })
);

updates.sort((left, right) => left.name.localeCompare(right.name));
for (const update of updates) {
  console.log(`${update.name}: ${update.before} -> ${update.after}`);
}
console.log(`${updates.length} packages need refreshing.`);
if (process.argv.includes('--write')) {
  writeFileSync(manifestURL, JSON.stringify(manifest, null, 2) + '\n');
}
