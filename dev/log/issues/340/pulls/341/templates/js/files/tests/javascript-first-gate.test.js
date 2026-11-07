import { describe, it, expect } from 'test-anywhere';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { itUnless, sandboxed, noPosixShell } from './helpers/skip.js';

const read = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const gatePath = '.github/workflows/javascript-first-gate.yml';
const example = 'examples/javascript-first';
function runStep(source, name, cwd, env) {
  const block = source.split(`- name: ${name}\n`)[1].split('\n      - ')[0];
  const script = block
    .split('run: |\n')[1]
    .split('\n')
    .filter((line) => line.startsWith('          '))
    .map((line) => line.slice(10))
    .join('\n');
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}
function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'javascript-first-'));
  try {
    cpSync(example, join(root, 'example'), { recursive: true });
    const git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-qm',
      'candidate'
    );
    callback(root, git('rev-parse', 'HEAD'), git);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
describe('JavaScript-first prerequisite and real mixed-language caller', () => {
  it('requires real commands and immutable checkouts without building Rust in the gate', () => {
    const source = read(gatePath);
    expect(source).toContain('workflow_call:');
    expect((source.match(/required: true/g) ?? []).length).toBe(4);
    expect(source).not.toContain('default:');
    expect(source).toContain('^[0-9a-f]{40}$');
    expect(source).not.toMatch(/\bcargo\b|\brustc\b/);
    expect(source).toContain('git ls-files --others --exclude-standard');
    expect(source).toContain('git diff --cached --exit-code');
    for (const action of ['checkout', 'setup-node']) {
      expect(source).toMatch(new RegExp(`actions/${action}@[a-f0-9]{40}`));
    }
    // A caller can select a PR revision even when dispatching from main.
    // Do not let that code write a dependency cache in main's trust scope.
    expect(source).toContain('package-manager-cache: false');
    expect(source).not.toMatch(
      /uses: actions\/cache@|\bcache: (npm|yarn|pnpm)/
    );
  });
  it('wires every Rust path to successful prerequisites and exactly the tested revision', () => {
    const caller = read('.github/workflows/javascript-first-example.yml');
    expect(caller).toContain(
      'uses: ./.github/workflows/javascript-first-gate.yml'
    );
    for (const name of [
      'check',
      'build',
      'test',
      'package',
      'container',
      'publish',
    ]) {
      const job = caller
        .split(`\n  rust-${name}:\n`)[1]
        .split(/\n {2}[\w-]+:\n/)[0];
      expect(job).toContain('needs: [javascript-first]');
      expect(job).toContain("if: needs.javascript-first.result == 'success'");
      expect(job).toContain(
        'ref: ${{ needs.javascript-first.outputs.tested-sha }}'
      );
    }
  });
  it('isolates caller-selected source execution to PR checks and trusted pushes', () => {
    const caller = read('.github/workflows/javascript-first-example.yml');
    const triggers = caller.split('\npermissions:')[0];
    expect(triggers).toContain('  pull_request:');
    expect(triggers).toContain('  push:');
    // Manual dispatch inherits the selected branch's writable cache scope.
    // Running an input-selected revision there exposes its runner cache token
    // even when setup-node's automatic cache is disabled.
    expect(triggers).not.toMatch(
      /workflow_dispatch:|repository_dispatch:|pull_request_target:|workflow_run:/
    );
  });
  itUnless(sandboxed, noPosixShell)(
    'blocks all downstream work for failed/skipped checks, parity gaps, drift and revision changes',
    () => {
      const source = read(gatePath);
      fixture((root, sha, git) => {
        const output = join(root, '.git', 'outputs');
        const env = { EXPECTED_SHA: sha, GITHUB_OUTPUT: output };
        const commands = [
          'node --test example/native-check.mjs',
          'node example/check-parity.mjs --strict',
          'node example/generate.mjs --check',
        ];
        const stages = [
          'Native JavaScript checks',
          'Strict feature parity inventory',
          'Deterministic regeneration check',
        ];
        function pipeline({ skip = false, fail = false } = {}) {
          if (skip) {
            return 'skipped';
          }
          for (let index = 0; index < stages.length; index++) {
            const CHECK_COMMAND =
              fail && index === 0
                ? 'node -e "process.exit(1)"'
                : commands[index];
            if (
              runStep(source, stages[index], root, { ...env, CHECK_COMMAND })
                .status !== 0
            ) {
              return 'failure';
            }
          }
          return runStep(source, 'Record successful revision', root, env)
            .status === 0
            ? 'success'
            : 'failure';
        }
        expect(pipeline()).toBe('success');
        expect(read(output)).toBe(`sha=${sha}\n`);
        // Evaluate the caller's actual success condition, for each Rust job.
        const caller = read('.github/workflows/javascript-first-example.yml');
        const conditions = [
          ...caller.matchAll(
            /^ {4}if: (needs.javascript-first.result == 'success')$/gm
          ),
        ];
        const allowed = (result) =>
          conditions.filter(([, condition]) =>
            Function(
              'result',
              `return ${condition.replace('needs.javascript-first.result', 'result')}`
            )(result)
          ).length;
        expect(allowed('success')).toBe(6);
        expect(allowed(pipeline({ fail: true }))).toBe(0);
        expect(allowed(pipeline({ skip: true }))).toBe(0);
        const inventoryPath = join(root, 'example/inventory.json');
        const inventory = read(inventoryPath);
        for (const status of ['missing', 'partial', 'carried']) {
          writeFileSync(
            inventoryPath,
            inventory.replace('"complete"', JSON.stringify(status))
          );
          expect(allowed(pipeline())).toBe(0);
        }
        writeFileSync(
          inventoryPath,
          inventory.replace(/\{\s*"id": "isEven"[\s\S]*?\}/, '')
        );
        expect(allowed(pipeline())).toBe(0);
        writeFileSync(inventoryPath, inventory);
        writeFileSync(join(root, 'example/generated/lib.rs'), '// drift');
        expect(allowed(pipeline())).toBe(0);
        git('restore', '.');
        writeFileSync(join(root, 'untracked'), 'drift');
        expect(allowed(pipeline())).toBe(0);
        rmSync(join(root, 'untracked'));
        writeFileSync(join(root, 'example/native.mjs'), '// changed source');
        expect(allowed(pipeline())).toBe(0);
        git('restore', '.');
        writeFileSync(join(root, 'new-file'), 'different revision');
        git('add', '.');
        git(
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.com',
          'commit',
          '-qm',
          'moved'
        );
        expect(allowed(pipeline())).toBe(0);
      });
    }
  );
});
