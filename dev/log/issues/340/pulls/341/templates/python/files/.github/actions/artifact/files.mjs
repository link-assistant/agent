// @actions/glob 0.7.0 calls Minimatch#matchOne, which minimatch 11 removed,
// and minimatch < 11.0.1 is GHSA-g3hv-75wg-m249 (issue #132). This walker keeps
// the semantics this action relied on: one pattern per line, `#` comments,
// `!` exclusions, implicit descendants of a matched directory, hidden entries
// skipped, and symbolic links never followed or uploaded.
import { Minimatch } from 'minimatch';
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MATCH_OPTIONS = { dot: true, nobrace: true, nocomment: true, noext: true, nonegate: true };

export function parsePatterns(input) {
  const patterns = [];
  for (let line of String(input).split(/\r?\n|\r/).map(x => x.trim())) {
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    while (line.startsWith('!')) { negate = !negate; line = line.slice(1); }
    if (line === '~' || line.startsWith('~/')) line = homedir() + line.slice(1);
    const absolute = path.resolve(line);
    const segments = absolute.split(path.sep);
    const literal = segments.findIndex(segment => /[*?[]/.test(segment));
    const searchPath = literal < 0 ? absolute : segments.slice(0, literal).join(path.sep) || path.sep;
    const matchers = [new Minimatch(absolute, MATCH_OPTIONS), new Minimatch(path.join(absolute, '**'), MATCH_OPTIONS)];
    patterns.push({ negate, searchPath, matches: item => matchers.some(m => m.match(item)) });
  }
  return patterns;
}

function included(patterns, item) {
  let result = false;
  for (const pattern of patterns) if (pattern.matches(item)) result = !pattern.negate;
  return result;
}

async function walk(item, visit) {
  if (path.basename(item).startsWith('.') && path.dirname(item) !== item) return;
  let stats;
  try { stats = await lstat(item); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stats.isFile()) visit(item);
  else if (stats.isDirectory()) {
    for (const child of await readdir(item)) await walk(path.join(item, child), visit);
  }
}

export async function findFiles(input) {
  const patterns = parsePatterns(input);
  const searchPaths = [...new Set(patterns.filter(p => !p.negate).map(p => p.searchPath))];
  const files = new Set();
  for (const searchPath of searchPaths) {
    await walk(searchPath, file => { if (included(patterns, file)) files.add(file); });
  }
  if (!files.size) throw new Error(`No files found; missing or empty artifact evidence: ${input}`);
  let root = searchPaths[0];
  for (const search of searchPaths) {
    while (path.relative(root, search).startsWith('..')) root = path.dirname(root);
  }
  if ((await lstat(root)).isFile()) root = path.dirname(root);
  return { files: [...files].sort(), root };
}

export async function packagePages(directory) {
  await findFiles(directory);
  const root = await mkdtemp(path.join(tmpdir(), 'pages-artifact-'));
  const file = path.join(root, 'artifact.tar');
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    // Match upload-pages-artifact@v5's GNU tar format and hidden-file policy.
    execFileSync(process.platform === 'darwin' ? 'gtar' : 'tar', [
      '--dereference', '--hard-dereference', '--directory', path.resolve(directory),
      '-cf', file, '--exclude=.git', '--exclude=.github', '--exclude=.[^/]*', '.',
    ], { stdio: 'pipe' });
    return { root, file, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
