/* eslint local/no-changelog-comments: "off" */

import { describe, expect } from 'test-anywhere';

import { itUnless, sandboxed } from './helpers/skip.js';
let lintDependencies;

async function getLintDependencies() {
  lintDependencies ??= Promise.all([
    import('eslint'),
    import('../eslint-rules/no-changelog-comments.js'),
  ]).then(([eslintModule, ruleModule]) => ({
    Linter: eslintModule.Linter,
    noChangelogCommentsRule: ruleModule.default,
  }));

  return lintDependencies;
}

async function lintFixture(code, options) {
  const { Linter, noChangelogCommentsRule } = await getLintDependencies();
  const linter = new Linter({ configType: 'flat' });
  const ruleConfig = options ? ['warn', options] : 'warn';

  return linter.verify(
    code,
    [
      {
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
        plugins: {
          local: {
            rules: {
              'no-changelog-comments': noChangelogCommentsRule,
            },
          },
        },
        rules: {
          'local/no-changelog-comments': ruleConfig,
        },
      },
    ],
    { filename: 'fixture.js' }
  );
}

async function ruleMessages(code, options) {
  const messages = await lintFixture(code, options);

  return messages.filter(
    (message) => message.ruleId === 'local/no-changelog-comments'
  );
}

describe('no-changelog-comments ESLint rule', () => {
  itUnless(sandboxed)(
    'reports comments, strings, and template literal text that describe change history',
    async () => {
      const messages = await ruleMessages(`
// previously this returned null
const cliText = 'renamed from build to release';
const templateText = \`now uses release notes instead of raw commits\`;
`);

      expect(messages.length).toBe(3);
      expect(messages[0].severity).toBe(1);
      expect(messages[0].message).toContain('current behavior');
    }
  );

  itUnless(sandboxed)(
    'detects Russian, Chinese, and Hindi history markers without ASCII word boundaries',
    async () => {
      const messages = await ruleMessages(`
// раньше был другой путь
const ru = 'теперь используем новый путь';
const zh = '以前是旧名称';
const hi = 'नाम बदला';
`);

      expect(messages.length).toBe(4);
    }
  );

  itUnless(sandboxed)(
    'does not report present-tense timing or state descriptions',
    async () => {
      const messages = await ruleMessages(`
// after we start the server, not before
const label = 'start now';
const note = 'no longer needed at this point';
`);

      expect(messages.length).toBe(0);
    }
  );

  itUnless(sandboxed)(
    'honors language, string, allowlist, and date options',
    async () => {
      expect(
        (
          await ruleMessages(`const ru = 'теперь используем новый путь';`, {
            languages: ['en'],
          })
        ).length
      ).toBe(0);

      expect(
        (
          await ruleMessages(`const text = 'renamed from build to release';`, {
            checkStrings: false,
          })
        ).length
      ).toBe(0);

      expect(
        (
          await ruleMessages(`// tracked upstream issue #39753`, {
            allow: ['issue #39753'],
          })
        ).length
      ).toBe(0);

      expect(
        (
          await ruleMessages(`const dateLabel = '2026-06-26';`, {
            allowDatesInStrings: true,
          })
        ).length
      ).toBe(0);

      expect(
        (await ruleMessages(`// 2026-06-26 maintenance note`)).length
      ).toBe(1);
    }
  );
});
