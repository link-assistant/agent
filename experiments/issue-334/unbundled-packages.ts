// Lists models.dev npm packages (provider or per-model) that the agent does
// not bundle and would install on first use. Usage: bun <this> [api.json]
import { readFileSync } from 'fs';
import os from 'os';
const file =
  process.argv[2] ?? `${os.homedir()}/.cache/link-assistant-agent/models.json`;
const db = JSON.parse(readFileSync(file, 'utf8'));
const src = readFileSync(
  `${import.meta.dir}/../../js/src/provider/provider.ts`,
  'utf8'
);
const bundled = new Set(
  [...src.matchAll(/^\s+'(@?[^']+)': create\w+,/gm)].map((m) => m[1])
);
const uses: Record<string, string[]> = {};
for (const [id, p] of Object.entries<any>(db)) {
  const pkgs = new Set<string>(
    [
      p.npm,
      ...Object.values<any>(p.models ?? {}).map((m) => m.provider?.npm),
    ].filter(Boolean)
  );
  for (const pkg of pkgs) if (!bundled.has(pkg)) (uses[pkg] ??= []).push(id);
}
console.log(JSON.stringify(uses, null, 1));
