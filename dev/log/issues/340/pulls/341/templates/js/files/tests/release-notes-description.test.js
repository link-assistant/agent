/**
 * Tests for the description that format-release-notes.mjs publishes: the
 * change sections must keep the structure Changesets wrote.
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import { buildReleaseDescription } from '../scripts/format-release-notes-helpers.mjs';

const MULTI_PARAGRAPH = `### Patch Changes

- 68f606a: First change.

  Second change of the same changeset.

  - nested bullet
  - another nested bullet

  ---

  Text after a rule, and a literal \`\\n\` in code. Ends with a "quote"`;

describe('buildReleaseDescription', () => {
  it('keeps paragraphs, nested lists, rules, escapes and quotes in the item', () => {
    const { description, commitHashes } =
      buildReleaseDescription(MULTI_PARAGRAPH);

    expect(description).toBe(MULTI_PARAGRAPH.split('\n').slice(2).join('\n'));
    expect(commitHashes).toEqual(['68f606a']);
  });

  it('keeps entries without a commit hash', () => {
    const { description, commitHashes } = buildReleaseDescription(
      '### Minor Changes\n\n- Add a feature\n'
    );

    expect(description).toBe('- Add a feature');
    expect(commitHashes).toEqual([]);
  });

  it('keeps the headings and every hash when several sections exist', () => {
    const { description, commitHashes } = buildReleaseDescription(
      [
        '### Minor Changes',
        '',
        '- abc1234: Add a feature',
        '',
        '### Patch Changes',
        '',
        '- def5678: Fix a bug   ',
        '- abc1234: Same commit again',
        '',
      ].join('\r\n')
    );

    expect(description).toBe(
      [
        '### Minor Changes',
        '',
        '- abc1234: Add a feature',
        '',
        '### Patch Changes',
        '',
        '- def5678: Fix a bug',
        '- abc1234: Same commit again',
      ].join('\n')
    );
    expect(commitHashes).toEqual(['abc1234', 'def5678']);
  });

  it('reports a body without change sections', () => {
    expect(buildReleaseDescription('Just text')).toBe(null);
    expect(buildReleaseDescription('')).toBe(null);
  });

  it('is what the formatter publishes, with a lookup for every hash', () => {
    const script = readFileSync('scripts/format-release-notes.mjs', 'utf8');

    expect(script).toContain('buildReleaseDescription(currentBody)');
    expect(script).toContain('for (const commitSha of commitShas)');
    expect(script).not.toContain(".replace(/---.*$/s, '')");
  });
});
