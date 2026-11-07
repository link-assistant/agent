#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REQUIRED_SECTIONS = {
  'README.md': ['Features', 'Quick Start', 'License'],
  'js/README.md': ['Installation', 'Usage', 'Development', 'License'],
  'rust/README.md': ['Installation', 'Quick Start', 'Development', 'License'],
  'TESTING.md': [
    'Running Tests Manually',
    'Continuous Integration',
    'Troubleshooting',
  ],
};

export function missingSections(text, required) {
  const headings = new Set(
    text.split('\n').filter((line) => line.startsWith('## '))
  );
  return required.filter((section) => !headings.has(`## ${section}`));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const files = execFileSync('git', ['ls-files', '-z', '*.md'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter(
      (file) =>
        !/^(dev\/log\/|docs\/case-studies\/|js\/docs\/case-studies\/)/.test(
          file
        )
    );
  let failures = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (text.split('\n').length > 2500) {
      console.error(`::error file=${file}::Documentation exceeds 2500 lines`);
      failures++;
    }
  }
  for (const [file, sections] of Object.entries(REQUIRED_SECTIONS)) {
    const text = readFileSync(file, 'utf8');
    if (!/^#\s+\S/m.test(text)) {
      console.error(`::error file=${file}::Missing document title`);
      failures++;
    }
    for (const section of missingSections(text, sections)) {
      console.error(
        `::error file=${file}::Missing required section: ${section}`
      );
      failures++;
    }
  }
  console.log(`Validated ${files.length} documentation files.`);
  process.exitCode = failures ? 1 : 0;
}
