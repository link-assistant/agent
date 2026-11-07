import { describe, expect } from 'test-anywhere';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { itUnless, sandboxed, noPosixShell } from './helpers/skip.js';

function format(body) {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    writeFileSync(join(dir, 'body'), JSON.stringify({ id: 1, body }));
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FIXTURE/requests"
case "$*" in
  *PATCH*) cat > "$FIXTURE/payload" ;;
  *commits/abcdef1/pulls*) printf '[[{"title":"feature","number":41}]]' ;;
  *commits/def5678/pulls*) printf '[[{"title":"fix","number":42}]]' ;;
  *commits/fallback/pulls*) printf '[[{"title":"fallback","number":43}]]' ;;
  *commits/*/pulls*) printf '[[{"title":"chore: version packages","number":99}]]' ;;
  *) cat "$FIXTURE/body" ;;
esac
`,
      { mode: 0o755 }
    );
    const result = spawnSync(
      'node',
      [
        '--import',
        pathToFileURL(resolve('experiments/release-notes-fixture.mjs')).href,
        resolve('scripts/format-release-notes.mjs'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FIXTURE: dir,
        },
      }
    );
    expect(`${result.status}: ${result.stderr}`).toBe('0: ');
    return {
      body: JSON.parse(readFileSync(join(dir, 'payload'), 'utf8')).body,
      requests: readFileSync(join(dir, 'requests'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe('real release formatter with offline gh', () => {
  itUnless(sandboxed, noPosixShell)(
    'publishes all Markdown entries and unique PRs through JSON stdin',
    () => {
      const content =
        '- abcdef1: first\n\n  Second paragraph.\n\n  - nested\n\n  ---\n\n  Literal `\\n` and a "quote"\n- def5678: second\n- abcdef1: repeated\n- aaaaaaa: no matching PR';
      const result = format(`### Patch Changes\n\n${content}`);
      expect(result.body).toContain(content);
      expect(result.body).toContain('**Related Pull Requests:** #41, #42');
      expect(result.body).not.toContain('#99');
      expect(result.requests.match(/commits\/abcdef1\/pulls/g).length).toBe(1);
      expect(result.requests).toContain('-X PATCH --input -');
    }
  );
  itUnless(sandboxed, noPosixShell)(
    'uses the supplied commit only when entries have no hash',
    () => {
      expect(format('### Minor Changes\n\n- Plain entry').body).toContain(
        '**Related Pull Request:** #43'
      );
    }
  );
});
