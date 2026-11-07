/** Reproduce the GitHub 300-file diff boundary in the prepared PR only. */
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(
  new URL('./issue-273-large-pr/', import.meta.url)
);
const names = Array.from(
  { length: 301 },
  (_, index) => `fixture-${String(index).padStart(3, '0')}.md`
);
const content = (name) =>
  `# CodeQL large-PR regression: ${name}\n\nTemporary fixture for issue 265. Remove after the hosted run is recorded.\n`;
if (process.argv[2] === 'create') {
  if (existsSync(directory)) {
    throw new Error('Refusing to overwrite an existing fixture directory');
  }
  mkdirSync(directory);
  for (const name of names) {
    writeFileSync(join(directory, name), content(name));
  }
} else if (process.argv[2] === 'remove') {
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(names)) {
    throw new Error('Unexpected fixture files; refusing cleanup');
  }
  for (const name of names) {
    if (readFileSync(join(directory, name), 'utf8') !== content(name)) {
      throw new Error('Modified fixture; refusing cleanup');
    }
  }
  for (const name of names) {
    unlinkSync(join(directory, name));
  }
  rmdirSync(directory);
} else {
  throw new Error(
    'Usage: node experiments/issue-273-large-pr.mjs create|remove'
  );
}
