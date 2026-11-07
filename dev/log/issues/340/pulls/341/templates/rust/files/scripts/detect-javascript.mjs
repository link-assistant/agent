// Detect tracked production JavaScript/TypeScript in the selected Rust project.
// Tooling and demonstration code alone do not establish a native counterpart.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function detectJavaScript(projectDirectory = '.') {
  const root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const directory = realpathSync(resolve(root, projectDirectory));
  const path = relative(root, directory);
  if (path === '..' || path.startsWith(`..${sep}`)) throw Error('Project directory must stay inside the checkout');
  const prefix = path ? `${path.split(sep).join('/')}/` : '';
  const excluded = /^(?:\..*|scripts?|tests?|__tests__|fixtures?|examples?|experiments?|docs?|web|frontend|ui|public|assets|static|node_modules|target|vendor|dist|build|coverage)$/i;
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const sources = files.filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length)).filter(file => {
    const parts = file.split('/');
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) &&
      !parts.slice(0, -1).some(part => excluded.test(part)) &&
      !/(?:^|[.-])(?:config|test|spec|d)\.(?:[cm]?[jt]s|[jt]sx)$/.test(parts.at(-1)) &&
      !/^(?:webpack|rollup|vite|vitest|jest|eslint|prettier|babel)\./.test(parts.at(-1));
  });
  // Keep an adopted port gated even if a commit removes all its native sources.
  const manifest = files.includes(`${prefix}package.json`)
    ? JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) : {};
  const configured = ['native', 'parity', 'translation'].some(stage =>
    Object.hasOwn(manifest.scripts ?? {}, `javascript-first:${stage}`));
  return { required: sources.length > 0 || configured, directory, sources };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(detectJavaScript(process.argv[2])));
}
