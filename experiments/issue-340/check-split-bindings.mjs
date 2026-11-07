/** Resolve runtime identifiers after stripping TypeScript from split modules. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Linter } from '../../js/node_modules/eslint/lib/api.js';

const files = [
  'auth/plugins',
  'auth/google-plugin',
  'auth/plugin-utils',
  'provider/provider',
  'provider/provider-loaders',
  'provider/provider-sdk',
  'session/prompt',
  'session/prompt-helpers',
];
const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' });
let failures = 0;
for (const file of files) {
  const source = process.argv[2]
    ? execFileSync('git', ['show', `${process.argv[2]}:js/src/${file}.ts`], {
        encoding: 'utf8',
      })
    : readFileSync(`js/src/${file}.ts`, 'utf8');
  const js = transpiler.transformSync(source);
  const issues = new Linter().verify(js, [
    {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: {
          ...Object.fromEntries(
            Object.getOwnPropertyNames(globalThis).map((name) => [
              name,
              'readonly',
            ])
          ),
        },
      },
      rules: { 'no-undef': 'error' },
    },
  ]);
  for (const issue of issues) {
    console.log(`${file}: ${issue.line}: ${issue.message}`);
  }
  failures += issues.length;
}
console.log(`Unresolved runtime references: ${failures}`);
process.exitCode = failures ? 1 : 0;
