import { describe, it, expect } from 'test-anywhere';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// GitHub links a commit to the github-actions[bot] account only through the
// numeric-prefixed no-reply address. Without the prefix the commit is
// "unattributed" and a ruleset with
// require_extra_approval_for_unattributed_changes blocks automated releases.
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const UNPREFIXED = 'github-actions[bot]@users.noreply.github.com';

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('github-actions[bot] commit attribution', () => {
  it('uses the prefixed bot e-mail in version-and-commit.mjs', () => {
    const script = readFileSync(
      join(repoRoot, 'scripts/version-and-commit.mjs'),
      'utf8'
    );

    expect(script).toContain(`git config user.email "${BOT_EMAIL}"`);
    expect(script).toContain(`git config user.name "github-actions[bot]"`);
  });

  it('uses the prefixed bot e-mail in simulate-fresh-merge.sh', () => {
    const script = readFileSync(
      join(repoRoot, 'scripts/simulate-fresh-merge.sh'),
      'utf8'
    );

    expect(script).toContain(`git config user.email "${BOT_EMAIL}"`);
    expect(script).toContain(`git config user.name "github-actions[bot]"`);
  });

  it('never configures the unprefixed bot e-mail in scripts or workflows', () => {
    const files = [
      ...collectFiles(join(repoRoot, 'scripts')),
      ...collectFiles(join(repoRoot, '.github/workflows')),
    ];

    const offenders = files.filter((file) => {
      const content = readFileSync(file, 'utf8');
      // Only the unprefixed form is a problem; strip the valid one first.
      return content.split(BOT_EMAIL).join('').includes(UNPREFIXED);
    });

    expect(offenders).toEqual([]);
  });
});
