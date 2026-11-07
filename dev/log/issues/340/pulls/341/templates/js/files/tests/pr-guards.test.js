import { blankEnv } from './helpers/env.js';
import { describe, expect } from 'test-anywhere';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { itUnless, sandboxed } from './helpers/skip.js';

const scripts = resolve('scripts');
const fragment = "---\n'fixture': patch\n---\n\nFix fixture\n";

describe('Dependabot changeset exemption', () => {
  itUnless(sandboxed)(
    'exempts the exact bot author before reading a diff',
    () =>
      fixture(({ invoke }) => {
        const result = invoke('validate-changeset.mjs', {
          PR_AUTHOR: 'dependabot[bot]',
          GITHUB_HEAD_SHA: 'unavailable',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('dependabot[bot]');
      })
  );
  itUnless(sandboxed)('does not exempt a branch impersonating Dependabot', () =>
    fixture(({ write, commit, invoke }) => {
      write('index.js', 'export const value = 2;\n');
      commit();
      expect(
        invoke('validate-changeset.mjs', {
          PR_AUTHOR: 'someone',
          GITHUB_HEAD_REF: 'dependabot/npm/fake',
        }).status
      ).toBe(1);
    })
  );
});

function fixture(run, { root = '.', existing = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'pr-guard-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (name, text) => {
    const path = join(cwd, root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  try {
    mkdirSync(join(cwd, root, '.changeset'), { recursive: true });
    write('package.json', '{"name":"fixture","version":"1.0.0"}\n');
    write('index.js', 'export const value = 1;\n');
    if (existing) {
      write('.changeset/existing.md', fragment);
    }
    git('init', '-b', 'main');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    const commit = () => {
      git('add', '-A');
      git('commit', '-qm', 'fixture');
    };
    commit();
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const base = git('rev-parse', 'HEAD');
    const invoke = (script, env = {}, args = []) => {
      const cleanEnv = blankEnv(process.env, (key) =>
        /^(GITHUB_|BASE_SHA$|HEAD_SHA$|CI$|JS_ROOT$|ALLOW_LOCAL_CHANGESET_SCAN$)/.test(
          key
        )
      );
      return spawnSync(process.execPath, [join(scripts, script), ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...cleanEnv, GITHUB_BASE_REF: 'main', JS_ROOT: root, ...env },
      });
    };
    run({ cwd, git, write, commit, invoke, base });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('parsed version guard', () => {
  itUnless(sandboxed)('accepts formatting with an unchanged version', () =>
    fixture(({ write, commit, invoke }) => {
      write(
        'package.json',
        '{\n    "version": "1.0.0",\n    "name": "fixture"\n}\n'
      );
      commit();
      expect(invoke('check-version.mjs').status).toBe(0);
    })
  );
  itUnless(sandboxed)('rejects a changed version', () =>
    fixture(({ write, commit, invoke }) => {
      write('package.json', '{"name":"fixture","version":"2.0.0"}\n');
      commit();
      expect(invoke('check-version.mjs').status).toBe(1);
    })
  );
  itUnless(sandboxed)('fails when the base ref is unavailable', () =>
    fixture(({ invoke }) => {
      expect(
        invoke('check-version.mjs', { GITHUB_BASE_REF: 'missing' }).status
      ).toBe(1);
    })
  );
  itUnless(sandboxed)(
    'fails when the explicitly requested PR head is unavailable',
    () =>
      fixture(({ invoke }) => {
        for (const script of ['check-version.mjs', 'validate-changeset.mjs']) {
          expect(invoke(script, { GITHUB_HEAD_SHA: 'missing' }).status).toBe(1);
        }
      })
  );
  itUnless(sandboxed)(
    'rejects a branch name impersonating release automation',
    () =>
      fixture(({ write, commit, invoke }) => {
        write('package.json', '{"name":"fixture","version":"2.0.0"}\n');
        commit();
        for (const GITHUB_HEAD_REF of [
          'changeset-release/main',
          'changeset-manual-release-42',
        ]) {
          expect(invoke('check-version.mjs', { GITHUB_HEAD_REF }).status).toBe(
            1
          );
        }
      })
  );
  itUnless(sandboxed)('rejects invalid JSON and missing versions', () =>
    fixture(({ write, commit, invoke }) => {
      for (const text of [
        '{invalid',
        '{"name":"fixture"}',
        '{"name":"fixture","version":2}',
      ]) {
        write('package.json', text);
        commit();
        expect(invoke('check-version.mjs').status).toBe(1);
      }
    })
  );
  itUnless(sandboxed)(
    'checks the JavaScript manifest in a multi-language repository',
    () =>
      fixture(
        ({ write, commit, invoke }) => {
          write('package.json', '{"name":"fixture","version":"2.0.0"}\n');
          commit();
          expect(invoke('check-version.mjs').status).toBe(1);
        },
        { root: 'js' }
      )
  );
  itUnless(sandboxed)('compares the PR manifest with its merge base', () =>
    fixture(({ git, write, commit, invoke }) => {
      git('checkout', '-b', 'pr');
      write('README.md', '# Fixture\n');
      commit();
      const head = git('rev-parse', 'HEAD');
      git('checkout', 'main');
      write('package.json', '{"name":"fixture","version":"2.0.0"}');
      commit();
      const base = git('rev-parse', 'HEAD');
      git('checkout', 'pr');
      expect(
        invoke('check-version.mjs', {
          GITHUB_BASE_SHA: base,
          GITHUB_HEAD_SHA: head,
        }).status
      ).toBe(0);
    })
  );
});

describe('PR changeset validation', () => {
  itUnless(sandboxed)(
    'does not accept a base fragment when the CI comparison fails',
    () =>
      fixture(
        ({ write, commit, invoke }) => {
          write('index.js', 'export const value = 2;\n');
          commit();
          expect(
            invoke('validate-changeset.mjs', {
              CI: 'true',
              GITHUB_BASE_REF: 'missing',
            }).status
          ).toBe(1);
        },
        { existing: true }
      )
  );
  itUnless(sandboxed)(
    'requires an explicit opt-in to directory scanning locally',
    () =>
      fixture(
        ({ invoke }) => {
          expect(
            invoke('validate-changeset.mjs', { GITHUB_BASE_REF: 'missing' })
              .status
          ).toBe(1);
          expect(
            invoke('validate-changeset.mjs', {
              GITHUB_BASE_REF: 'missing',
              ALLOW_LOCAL_CHANGESET_SCAN: 'true',
            }).status
          ).toBe(0);
          expect(
            invoke('validate-changeset.mjs', {
              GITHUB_BASE_REF: 'missing',
              ALLOW_LOCAL_CHANGESET_SCAN: 'true',
              CI: 'true',
            }).status
          ).toBe(1);
        },
        { existing: true }
      )
  );
  itUnless(sandboxed)(
    'accepts exactly one added fragment and ignores existing ones',
    () =>
      fixture(
        ({ write, commit, invoke }) => {
          write('index.js', 'export const value = 2;\n');
          write('.changeset/new.md', fragment);
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(0);
        },
        { existing: true }
      )
  );
  itUnless(sandboxed)('does not count an edited existing fragment', () =>
    fixture(
      ({ write, commit, invoke }) => {
        write('index.js', 'export const value = 2;\n');
        write('.changeset/existing.md', `${fragment}Extra\n`);
        commit();
        expect(invoke('validate-changeset.mjs').status).toBe(1);
      },
      { existing: true }
    )
  );
  itUnless(sandboxed)(
    'rejects multiple added fragments and malformed frontmatter',
    () =>
      fixture(({ git, write, commit, invoke }) => {
        write('index.js', 'export const value = 2;\n');
        write('.changeset/a.md', fragment);
        write('.changeset/b.md', fragment);
        commit();
        expect(invoke('validate-changeset.mjs').status).toBe(1);
        write(
          '.changeset/b.md',
          "Not frontmatter\n'fixture': patch\n---\n---\nFake\n"
        );
        git('rm', '.changeset/a.md');
        commit();
        expect(invoke('validate-changeset.mjs').status).toBe(1);
      })
  );
});

describe('PR changeset scope validation', () => {
  itUnless(sandboxed)('exempts documentation-only changes', () =>
    fixture(({ write, commit, invoke }) => {
      write('README.md', '# Documentation\n');
      commit();
      expect(invoke('validate-changeset.mjs').status).toBe(0);
    })
  );
  itUnless(sandboxed)(
    'validates optional fragments in documentation-only PRs',
    () =>
      fixture(({ write, commit, invoke }) => {
        write('README.md', '# Documentation\n');
        write('.changeset/docs.md', 'Invalid fragment\n');
        commit();
        expect(invoke('validate-changeset.mjs').status).toBe(1);
        write('.changeset/docs.md', fragment);
        commit();
        expect(invoke('validate-changeset.mjs').status).toBe(0);
      })
  );
  itUnless(sandboxed)(
    'requires a fragment for multi-language JS code and handles spaces in names',
    () =>
      fixture(
        ({ write, commit, invoke }) => {
          write('index.js', 'export const value = 2;\n');
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(1);
          write('.changeset/with spaces.md', fragment);
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(0);
        },
        { root: './js' }
      )
  );
  itUnless(sandboxed)(
    'exempts unrelated language roots in a multi-language repository',
    () =>
      fixture(
        ({ cwd, commit, invoke }) => {
          mkdirSync(join(cwd, 'rust'), { recursive: true });
          writeFileSync(join(cwd, 'rust/lib.rs'), 'fn main() {}\n');
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(0);
        },
        { root: 'js' }
      )
  );
  itUnless(sandboxed)('counts PR fragments relative to the merge base', () =>
    fixture(({ git, write, commit, invoke }) => {
      git('checkout', '-b', 'pr');
      write('index.js', 'export const value = 2;\n');
      commit();
      const head = git('rev-parse', 'HEAD');
      git('checkout', 'main');
      write('.changeset/base-only.md', fragment);
      commit();
      const advancedBase = git('rev-parse', 'HEAD');
      git('checkout', 'pr');
      expect(
        invoke('validate-changeset.mjs', {
          GITHUB_BASE_SHA: advancedBase,
          GITHUB_HEAD_SHA: head,
        }).status
      ).toBe(1);
      write('.changeset/pr.md', fragment);
      commit();
      expect(
        invoke('validate-changeset.mjs', {
          GITHUB_BASE_SHA: advancedBase,
          GITHUB_HEAD_SHA: git('rev-parse', 'HEAD'),
        }).status
      ).toBe(0);
    })
  );
});

describe('exact changeset rename detection', () => {
  for (const root of ['.', 'js']) {
    itUnless(sandboxed)(
      `does not count an unchanged pending fragment moved in ${root}`,
      () =>
        fixture(
          ({ git, write, commit, invoke }) => {
            write('index.js', 'export const value = 2;\n');
            git(
              'mv',
              `${root}/.changeset/existing.md`,
              `${root}/.changeset/moved fragment.md`
            );
            commit();
            const result = invoke('validate-changeset.mjs');
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('No changeset found');
            write('.changeset/new.md', `${fragment}New work\n`);
            commit();
            expect(invoke('validate-changeset.mjs').status).toBe(0);
          },
          { root, existing: true }
        )
    );
  }
  itUnless(sandboxed)(
    'counts a new fragment replacing a similar deleted one',
    () =>
      fixture(
        ({ git, write, commit, invoke }) => {
          git('rm', '.changeset/existing.md');
          write('index.js', 'export const value = 2;\n');
          write('.changeset/replacement.md', `${fragment}New work\n`);
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(0);
        },
        { existing: true }
      )
  );
  for (const [source, destination] of [
    ['index.js', 'docs/moved.md'],
    ['docs/source.md', 'moved.js'],
  ]) {
    itUnless(sandboxed)(
      `requires a fragment when moving ${source} to ${destination}`,
      () =>
        fixture(({ git, write, commit, invoke }) => {
          write(source, 'export const moved = 1;\n');
          commit();
          git('update-ref', 'refs/remotes/origin/main', 'HEAD');
          mkdirSync(
            dirname(join(git('rev-parse', '--show-toplevel'), destination)),
            {
              recursive: true,
            }
          );
          git('mv', source, destination);
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(1);
        })
    );
  }
  itUnless(sandboxed)(
    'parses NUL-separated rename paths without losing following additions',
    () =>
      fixture(
        ({ git, write, commit, invoke }) => {
          const destination =
            process.platform === 'win32'
              ? '.changeset/moved fragment.md'
              : '.changeset/moved\tfragment.md';
          git('mv', '.changeset/existing.md', destination);
          write('index.js', 'export const value = 2;\n');
          write('.changeset/z-new.md', `${fragment}New work\n`);
          commit();
          expect(invoke('validate-changeset.mjs').status).toBe(0);
        },
        { existing: true }
      )
  );
});

describe('trusted release PR identity', () => {
  itUnless(sandboxed)(
    'preserves the exemption for the same-repository release actor only',
    () =>
      fixture(({ cwd, write, commit, invoke }) => {
        write('package.json', '{"name":"fixture","version":"2.0.0"}');
        commit();
        const eventPath = join(cwd, 'event.json');
        const pr = {
          user: { login: 'github-actions[bot]' },
          head: {
            ref: 'changeset-release/main',
            repo: { full_name: 'fixture/repo' },
          },
          base: { repo: { full_name: 'fixture/repo' } },
        };
        const env = {
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: 'fixture/repo',
        };
        writeFileSync(eventPath, JSON.stringify({ pull_request: pr }));
        expect(invoke('check-version.mjs', env).status).toBe(0);
        expect(invoke('validate-changeset.mjs', env).status).toBe(0);
        pr.head.repo.full_name = 'attacker/fork';
        writeFileSync(eventPath, JSON.stringify({ pull_request: pr }));
        expect(invoke('check-version.mjs', env).status).toBe(1);
        pr.head.repo.full_name = 'fixture/repo';
        pr.user.login = 'human';
        writeFileSync(eventPath, JSON.stringify({ pull_request: pr }));
        expect(invoke('check-version.mjs', env).status).toBe(1);
        expect(
          invoke('check-version.mjs', { ...env, RELEASE_PR_ACTOR: 'human' })
            .status
        ).toBe(0);
        expect(
          invoke('check-version.mjs', { ...env, GITHUB_BASE_REF: 'missing' })
            .status
        ).toBe(1);
      })
  );
  itUnless(sandboxed)(
    'treats shell metacharacters in an unavailable ref as data',
    () =>
      fixture(({ cwd, invoke }) => {
        const result = invoke('check-version.mjs', {
          GITHUB_BASE_REF: 'missing; touch sentinel',
        });
        expect(result.status).toBe(1);
        expect(
          spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
            cwd,
            encoding: 'utf8',
          }).stdout
        ).toBe('');
      })
  );
});
