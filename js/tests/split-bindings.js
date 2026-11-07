import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Linter } from 'eslint';

// A successful bundle strips types but does not catch missing runtime imports.
// Analyze the actual transpiled modules so all branches retain their bindings.
test.each([
  'auth/plugins',
  'auth/google-plugin',
  'auth/plugin-utils',
  'auth/google-security',
  'provider/provider',
  'provider/provider-loaders',
  'provider/provider-sdk',
  'session/prompt',
  'session/prompt-helpers',
])(
  'split TypeScript module has no unresolved runtime names: %s',
  (file) => {
    const source = readFileSync(
      new URL(`../src/${file}.ts`, import.meta.url),
      'utf8'
    );
    const js = new Bun.Transpiler({
      loader: 'ts',
      target: 'bun',
    }).transformSync(source);
    const messages = new Linter().verify(js, [
      {
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          globals: Object.fromEntries(
            Object.getOwnPropertyNames(globalThis).map((name) => [
              name,
              'readonly',
            ])
          ),
        },
        rules: { 'no-undef': 'error' },
      },
    ]);
    expect(messages.map((message) => message.message)).toEqual([]);
  },
  10000
);
