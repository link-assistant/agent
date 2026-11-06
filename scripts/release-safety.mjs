// Release jobs may replay generated metadata, but must never publish source or
// dependencies that have not passed the checks for their triggering commit.
import { execFileSync } from 'node:child_process';
import { parseCrateInfo, setPackageVersion } from './rust-package-info.mjs';

const git = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const prefix = (root) =>
  !root || root === '.' ? '' : `${root.replace(/\/$/, '')}/`;
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function metadataFile(file, { jsRoot = 'js', rustRoot = 'rust' } = {}) {
  const js = prefix(jsRoot);
  const rust = prefix(rustRoot);
  return (
    [
      `${js}package.json`,
      `${js}package-lock.json`,
      `${js}bun.lock`,
      `${js}CHANGELOG.md`,
      `${rust}Cargo.toml`,
      `${rust}Cargo.lock`,
      `${rust}CHANGELOG.md`,
    ].includes(file) ||
    (file.startsWith(`${js}.changeset/`) && file.endsWith('.md')) ||
    (file.startsWith(`${rust}changelog.d/`) && file.endsWith('.md'))
  );
}

export function assertReleaseMetadata(files, roots) {
  const invalid = files.filter((file) => !metadataFile(file, roots));
  if (invalid.length) {
    throw new Error(
      `Release changed non-metadata files: ${invalid.join(', ')}`
    );
  }
}

export function setLockPackageVersion(text, name, version) {
  let found = false;
  const next = text.replace(
    /\[\[package\]\][\s\S]*?(?=\n\[\[package\]\]|$)/g,
    (block) => {
      if (!new RegExp(`^name = "${escape(name)}"$`, 'm').test(block)) {
        return block;
      }
      found = true;
      return block.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
    }
  );
  if (!found) {
    throw new Error(`Root package ${name} missing from Cargo.lock`);
  }
  return next;
}

export function equivalentMetadata(file, before, after, crateName) {
  if (file.endsWith('package.json') || file.endsWith('package-lock.json')) {
    const normalize = (text) => {
      const value = JSON.parse(text);
      delete value.version;
      if (value.packages?.['']) {
        delete value.packages[''].version;
      }
      return JSON.stringify(value);
    };
    return normalize(before) === normalize(after);
  }
  if (file.endsWith('Cargo.toml')) {
    return (
      setPackageVersion(before, '0.0.0') === setPackageVersion(after, '0.0.0')
    );
  }
  if (file.endsWith('Cargo.lock')) {
    return (
      setLockPackageVersion(before, crateName, '0.0.0') ===
      setLockPackageVersion(after, crateName, '0.0.0')
    );
  }
  // bun.lock embeds the root version in some Bun releases. Dependency changes
  // in this lock are deliberately not accepted as an automatic release sync.
  if (file.endsWith('bun.lock')) {
    return before === after;
  }
  return true;
}

export function assertSafeAdvance(from, to, roots = {}) {
  const changed = git(['diff', '--name-only', from, to, '--'])
    .split('\n')
    .filter(Boolean);
  const rustRoot = roots.rustRoot || 'rust';
  const cargo = `${prefix(rustRoot)}Cargo.toml`;
  let crateName;
  if (changed.some((file) => file.endsWith('Cargo.lock'))) {
    crateName = parseCrateInfo(git(['show', `${to}:${cargo}`])).name;
  }
  for (const file of changed) {
    if (!metadataFile(file, roots)) {
      throw new Error(
        `Main source changed after validation (${file}); publish from the newer CI run.`
      );
    }
    if (
      /\.(?:json|toml|lock)$/.test(file) &&
      !equivalentMetadata(
        file,
        git(['show', `${from}:${file}`]),
        git(['show', `${to}:${file}`]),
        crateName
      )
    ) {
      throw new Error(
        `Main dependencies changed after validation (${file}); publish from the newer CI run.`
      );
    }
  }
  if (process.env.DEBUG) {
    console.log(`Release synchronization ${from}..${to}:`, changed);
  }
}

export function syncReleaseCheckout(roots = {}) {
  git(['fetch', 'origin', 'main']);
  const base = git(['merge-base', 'HEAD', 'origin/main']);
  assertSafeAdvance(base, 'origin/main', roots);
  git(['rebase', 'origin/main']);
}

export function assertStagedReleaseMetadata(roots) {
  assertReleaseMetadata(
    git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean),
    roots
  );
}
