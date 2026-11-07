import { describe, expect, it } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import { printUntrusted } from '../scripts/github-actions-log.mjs';

function capturePrint(value, options = {}) {
  let output = '';
  printUntrusted(value, {
    stream: { write: (chunk) => (output += chunk) },
    ...options,
  });
  return output;
}

describe('printing untrusted CI log text', () => {
  it('prints ordinary local output without workflow markers', () => {
    expect(
      capturePrint('quoted ##[error] text', { githubActions: false })
    ).toBe('quoted ##[error] text\n');
  });

  it('brackets the complete value while GitHub interprets log commands', () => {
    const output = capturePrint('##[error]not a real annotation', {
      githubActions: true,
      tokenFactory: () => '0123456789abcdef0123456789abcdef',
    });

    expect(output).toBe(
      [
        '::stop-commands::0123456789abcdef0123456789abcdef',
        '##[error]not a real annotation',
        '::0123456789abcdef0123456789abcdef::',
        '',
      ].join('\n')
    );
  });

  it('uses a fresh unpredictable 128-bit token for each print', () => {
    const first = capturePrint('first', { githubActions: true });
    const second = capturePrint('second', { githubActions: true });
    const tokenPattern = /^::stop-commands::([0-9a-f]{32})$/m;
    const firstToken = first.match(tokenPattern)?.[1];
    const secondToken = second.match(tokenPattern)?.[1];

    expect(firstToken).not.toBe(undefined);
    expect(secondToken).not.toBe(undefined);
    expect(firstToken === secondToken).toBe(false);
    expect(first).toContain(`::${firstToken}::`);
    expect(second).toContain(`::${secondToken}::`);
  });

  it('routes every changeset or operator-authored body through the guard', () => {
    const guardedScripts = [
      'scripts/validate-changeset.mjs',
      'scripts/merge-changesets.mjs',
      'scripts/create-manual-changeset.mjs',
      'scripts/version-and-commit.mjs',
    ];

    for (const file of guardedScripts) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("from './github-actions-log.mjs'");
      expect(source).toContain('printUntrusted(');
    }
  });
});
